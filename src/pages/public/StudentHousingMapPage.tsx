import React from 'react';
import { useNavigate } from 'react-router-dom';
import StudentVerifiedPropertiesMap, { VerifiedMapProperty } from '../../components/map/StudentVerifiedPropertiesMap';
import { AREA_CENTERS } from '../../domain/geoUtils';

export function StudentHousingMapPage() {
  const navigate = useNavigate();

  // Verified case-study viewport coordinates for Kano State off-campus hubs around BUK New Campus
  // MapLibre coordinates order: [longitude, latitude]
  const caseStudyViewports = {
    Dambare: {
      center: [AREA_CENTERS.Dambare.longitude, AREA_CENTERS.Dambare.latitude] as [number, number],
      zoom: 15,
    },
    'Rimin Gata': {
      center: [AREA_CENTERS['Rimin Gata'].longitude, AREA_CENTERS['Rimin Gata'].latitude] as [number, number],
      zoom: 15,
    },
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 px-2 sm:px-4 py-4">
      <StudentVerifiedPropertiesMap
        caseStudyViewports={caseStudyViewports}
        onPropertyOpen={(property: VerifiedMapProperty) => navigate(`/properties/${property.id}`)}
      />
    </div>
  );
}

export default StudentHousingMapPage;
