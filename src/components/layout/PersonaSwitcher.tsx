import React from 'react';

interface PersonaSwitcherProps {
  currentUserId?: string;
  onPersonaChange?: () => void;
}

/**
 * PersonaSwitcher is disabled in production/MVP mode so unauthenticated or
 * unauthorized users can never switch into demo personas or bypass Firebase Auth.
 */
export const PersonaSwitcher: React.FC<PersonaSwitcherProps> = () => {
  return null;
};
