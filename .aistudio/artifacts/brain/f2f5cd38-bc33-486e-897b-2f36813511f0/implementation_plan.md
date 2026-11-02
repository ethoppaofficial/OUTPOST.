# OUTPOST: Advanced Accommodation Map and Location-Based Discovery Enhancements

## 1. Executive Summary & Context

This implementation plan specifies the architectural design, component modifications, algorithms, security controls, and testing strategy for upgrading the OUTPOST map and geospatial discovery engine.

The system serves students, landlords, and administrators of Bayero University Kano (BUK New Site), strictly constrained to off-campus accommodation in **Danbare** (opposite the campus main gate along Gwarzo Road) and **Rimin Gata** (the residential settlement west of campus).

Based on user-confirmed architectural decisions:
1. **Pedestrian Routing Engine**: Open Source Routing Machine (OSRM) Foot Profile with automatic fallback to verified straight-line distance (clearly labeled).
2. **Access Gate Proximity**: Proximity information displays distances and estimated walking times to **both BUK New Site Gate 1 and Gate 2 simultaneously**.
3. **Marker Clustering**: Native MapLibre GL JS vector circle clustering with point count badges, interactive cluster zoom-expansion, and rich unclustered property popups.
4. **Directional Context**: Automated 8-point compass orientation relative to verified local reference landmarks.
5. **External Navigation**: Safe "Get Directions" action supporting both Google Maps and OpenStreetMap with coordinate validation and tabnabbing defense (`rel="noopener noreferrer"`).
6. **Spatial Canvas Filters**: Floating filter chips directly on the map canvas for Budget, Accommodation Type, Gender Policy, and Settlement Area.

---

## 2. Existing Mapping & Data Architecture

### Current Implementation
- **Map Library**: `maplibre-gl` (v6.15.0) initialized with a dedicated web worker in `src/infrastructure/config/maplibreSetup.ts`.
- **Tile & Geocoding Provider**: MapTiler Streets (`v2`) vector tiles, with satellite/outdoors styles in `MapStyleSelector.tsx`, and 3D building extrusions in `mapConfig.ts`.
- **Existing Map Components**:
  - `PropertyMap.tsx`: Main map component used on the `/properties` page and in `PropertyDetailPage.tsx`.
  - `StudentVerifiedPropertiesMap.tsx`: Dedicated student view of approved accommodations.
  - `LandlordPinPlacementMapModal.tsx` & `LandlordPinPicker.tsx`: Landlord building pin picker with address search and GPS.
- **Geospatial Utilities (`src/domain/geoUtils.ts`)**:
  - `calculateDistanceKm`: Haversine formula (Earth radius 6,371 km).
  - `calculateCoarseDirection`: 8-point compass sector calculator (`bearingToCompassSector`).
  - `computePublicCoordinates`: Privacy-preserving coordinate jitter (~30–50m offset) for public listings to protect exact private landlord device coordinates.
  - Reference point: Currently defines single `BUK_NEW_CAMPUS_GATE` (`11.9808, 8.4235`).
- **Data Model (`src/domain/types.ts`)**:
  - `Property`: contains `location` (`latitude`, `longitude`, `publicLatitude`, `publicLongitude`, `precision`, `verificationStatus`), `pricePerSession`, `propertyType`, `genderPolicy`, `neighbourhood`.
  - Database schema: `properties` table references `property_locations` table and `units` table.

---

## 3. Detailed Feature Specifications

### Feature 1: Walking Distance and Estimated Walking Time to BUK Gates
- **Configurable Gate Reference Landmarks**:
  - `BUK_NEW_CAMPUS_GATE_1`: Latitude `11.9808`, Longitude `8.4235` (Main Gate along Gwarzo Road, facing Danbare).
  - `BUK_NEW_CAMPUS_GATE_2`: Latitude `11.9752`, Longitude `8.4190` (Secondary access gate serving southern Danbare and Rimin Gata corridors).
- **Dual Proximity Display**:
  - Every property card, detail view, and map popup will present dual proximity:
    - **Gate 1**: e.g., `8 min walk (650 m)` or `~650 m straight-line distance`
    - **Gate 2**: e.g., `14 min walk (1.1 km)` or `~1.1 km straight-line distance`
- **Routing Engine & Resilient Fallback**:
  - Primary: OSRM Public Foot Profile service (`https://routing.openstreetmap.de/routed-foot/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=false` or `https://router.project-osrm.org/route/v1/foot/...`).
  - Fallback: When offline, network fails, or service returns non-200, compute straight-line distance using `calculateDistanceKm()`, formatted with explicit disclaimer:
    `"Approximately 650 m straight-line distance"` (never misrepresenting straight-line distance as a turn-by-turn walking route).
- **Performance & Cache Strategy (`walkingRouteService.ts`)**:
  - In-memory client-side cache indexed by `[propLat, propLon, gateId]`.
  - Cache TTL: 24 hours.
  - Lazy evaluation: Only fetch walking routes when a property card enters viewport, when a map popup is opened, or on `PropertyDetailPage`. Zero bulk routing requests on initial page load.

### Feature 2: Landmark Orientation and Directional Context
- **Verified Local Reference Landmarks**:
  - BUK New Site Gate 1 (`11.9808, 8.4235`)
  - BUK New Site Gate 2 (`11.9752, 8.4190`)
  - Danbare Market & Commercial Hub (`11.9848, 8.4172`)
  - Rimin Gata Settlement Centre (`11.9785, 8.4093`)
- **Compass Calculation**:
  - For any given property coordinates, find the closest reference landmark.
  - Compute bearing from landmark to property using `calculateCoarseDirection(landmarkLat, landmarkLon, propLat, propLon)`.
  - Format directional text: e.g., `"North-West of Danbare Market (~250 m)"` or `"West of BUK Gate 1 (~500 m)"`.
  - Display as a contextual badge on Property Cards, Property Detail Page, and Map Marker Popups.

### Feature 3: External Directions and Navigation
- **Action UI**: Add an accessible, prominent "Get Directions" button on `PropertyDetailPage.tsx` and in map popups.
- **Provider Modal / Menu**:
  1. **Google Maps**:
     `https://www.google.com/maps/dir/?api=1&destination={latitude},{longitude}&travelmode=walking`
  2. **OpenStreetMap**:
     `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;{latitude},{longitude}` (or query-based coordinate pin).
- **Security & Link Hygiene**:
  - Strict validation of destination latitude/longitude (finite numbers within Kano bounding box `11.85 <= lat <= 12.10`, `8.30 <= lon <= 8.60`).
  - Apply `target="_blank"` and `rel="noopener noreferrer"`.
  - Clear user disclosure: *"External navigation will open in your mapping app. Walking routes are advisory."*

### Feature 4: Spatial Price and Accommodation Filters on Map Canvas
- **Floating Controls**: Compact overlay bar placed at the top-right / top-center of `PropertyMap.tsx` with responsive drop-downs/chips:
  - **Budget Filter**:
    - All Prices
    - Up to ₦150,000 / session
    - ₦150,000 – ₦250,000 / session
    - ₦250,000 – ₦400,000 / session
    - Above ₦400,000 / session
  - **Accommodation Type** (derived from database enum):
    - All Types
    - Self-Contained (`self_contained`)
    - Single Room (`single_room`)
    - Shared Apartment (`shared_apartment`)
    - Room & Parlour (`room_and_parlour`)
  - **Gender Accommodation Policy** (derived from database enum):
    - All Policies
    - Male Only (`male_only`)
    - Female Only (`female_only`)
    - Mixed (`mixed`)
  - **Location Corridor**:
    - All Areas
    - Danbare
    - Rimin Gata
- **Dynamic Interaction**:
  - Live client-side filtering updating the clustered GeoJSON source immediately without full map rebuild.
  - Filter counter badge: e.g., *"Showing 12 of 18 accommodations"*.
  - "Clear Filters" button when any filter is active.
  - Elegant empty state toast on map when no properties match the selected criteria.

### Feature 5: Native MapLibre Vector Circle Marker Clustering
- **GeoJSON Source Setup**:
  ```ts
  map.addSource('accommodations-geojson', {
    type: 'geojson',
    data: featureCollection,
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });
  ```
- **Layer Architecture**:
  1. **Cluster Circles (`clusters`)**:
     - Circles styled with tiered colors and sizes based on property count:
       - < 5 properties: Emerald (`#10b981`), radius 18px
       - 5–15 properties: Blue (`#3b82f6`), radius 24px
       - > 15 properties: Indigo (`#6366f1`), radius 30px
     - Subtle white border and drop shadow.
  2. **Cluster Counts (`cluster-count`)**:
     - Formatted text displaying `{point_count_abbreviated}` with bold white typography.
  3. **Unclustered Points (`unclustered-point`)**:
     - Individual property pins with price badge or custom pin SVG icon indicating verified accommodation.
- **Cluster Interaction**:
  - Clicking a cluster fires `source.getClusterExpansionZoom(clusterId, ...)` and smoothly eases map camera to the target coordinates and zoom level.
- **Unclustered Point Interaction**:
  - Clicking an unclustered property opens an interactive HTML `Popup` containing:
    - Property title & photo thumbnail
    - Annual rent & billing period
    - Dual BUK Gate 1 & Gate 2 walking distances
    - Landmark orientation
    - Direct link to `/properties/{slug}`
    - "Get Directions" trigger

---

## 4. Files Likely to be Created / Modified

| File Path | Action | Description |
| :--- | :--- | :--- |
| `src/domain/geoUtils.ts` | **Modify** | Add BUK Gate 1 and Gate 2 landmark definitions, local settlement landmarks, landmark orientation resolver, and coordinate validator |
| `src/application/services/walkingRouteService.ts` | **Create** | Dedicated service for OSRM walking distance/duration calculation with LRU in-memory cache and labeled straight-line fallback |
| `src/components/map/PropertyMap.tsx` | **Modify** | Implement native MapLibre GeoJSON clustering, cluster zoom click handlers, rich popups, and floating canvas filter chips |
| `src/components/map/StudentVerifiedPropertiesMap.tsx` | **Modify** | Integrate clustering, dual-gate proximity labels, and filter controls |
| `src/pages/public/PropertyDetailPage.tsx` | **Modify** | Add dual-gate proximity panel, landmark directional context, and "Get Directions" external navigation modal/button |
| `src/components/ui/PropertyCard.tsx` | **Modify** | Display dual-gate proximity and relative landmark orientation badge |
| `test/map-enhancements.test.mjs` | **Create** | Comprehensive regression tests for walking route caching, dual gate calculations, compass orientations, external URL security, and filter logic |

---

## 5. Required Database & External Service Changes

### Database Changes
- **Strictly None**: The existing Supabase schema already stores `properties`, `property_locations` (`latitude`, `longitude`, `public_latitude`, `public_longitude`, `precision`, `verification_status`), `units`, and enums (`property_type`, `gender_policy`). All new map features run on the frontend and client service layer without modifying migrations, RLS policies, or schemas.

### External Services & Cost Implications
- **MapTiler**: Existing vector tiles and streets styles are reused. No new MapTiler paid add-ons are introduced.
- **OSRM Foot Routing**: Public pedestrian routing engine is consumed via standard client fetch with client-side caching. Zero cost.
- **Google Maps & OpenStreetMap Navigation**: Standard URI schemes (`https://www.google.com/maps/dir/...`). These open on the student's personal client device/browser. Zero API cost to the platform.

---

## 6. Security & Privacy Considerations

1. **Exact GPS Protection**:
   - Only public coordinates (`publicLatitude`, `publicLongitude`) or admin-verified coordinates are used in public map sources and external navigation links.
   - Exact landlord device GPS remains shielded in private tables.
2. **Device Location Privacy**:
   - Single-shot user-initiated geolocation (`requestCurrentDevicePosition`) is strictly maintained; no background GPS tracking or watchPosition is added.
3. **External Link Defense**:
   - All navigation links generated in the UI strictly apply `target="_blank"` and `rel="noopener noreferrer"`.
   - Latitude and longitude parameters are sanitized to prevent URL injection or open redirects.
4. **Verification Boundary**:
   - Only approved properties (`verificationStatus === 'approved'`) with valid coordinates are fed into the map GeoJSON cluster source. Unverified properties never appear on the public map.

---

## 7. Performance & Optimization Strategy

1. **MapLibre Native Clustering**:
   - Moving from individual DOM `maplibregl.Marker` elements to WebGL-accelerated GeoJSON circle layers dramatically cuts DOM node counts from $O(N)$ to $O(\text{visible clusters})$, ensuring 60fps panning on mobile devices.
2. **Pedestrian Route Caching**:
   - Route calculations are cached by coordinate hash. When a student hovers or opens a property, the cached route is returned synchronously.
3. **Canvas Filter Reactivity**:
   - Filter chips directly mutate the in-memory GeoJSON source (`source.setData(...)`), preventing expensive map canvas unmounting and re-initialization.

---

## 8. Verification & Testing Strategy

1. **Automated Regression Suite (`test/map-enhancements.test.mjs`)**:
   - Unit tests verifying BUK Gate 1 and Gate 2 coordinate boundaries.
   - Unit tests verifying OSRM routing response parsing, duration formatting (`X min walk`), and error fallback to `"~X m straight-line distance"`.
   - Unit tests verifying 8-point compass orientation against Danbare Market and BUK Gates.
   - Unit tests verifying external Google Maps & OSM URL generation and coordinate boundary validation.
   - Unit tests verifying filter predicate logic (budget tiers, accommodation types, gender policies).
2. **Build & Lint Verification**:
   - Run `npm test` to ensure all existing 145 tests + new map test suites pass (100% pass rate).
   - Run `npm run lint` (`tsc --noEmit`) to confirm zero TypeScript errors.
   - Run `compile_applet` (`npm run build`) to ensure the Vite production build succeeds.
3. **Manual Interactive Verification**:
   - Inspect map cluster rendering, click-to-expand behavior, and rich popup details.
   - Verify floating filter chips on map canvas update markers instantly.
   - Test "Get Directions" button opens valid Google Maps and OpenStreetMap URLs.
