import type { PrdTemplateSectionId } from './prd-template';

/** Former /template/ heading fragments, mapped to the closest current section. */
export const PRD_TEMPLATE_ALIASES = {
  'mission-and-stop-condition': 'summary-outcome',
  mocks: 'user-experience',
  'technical-specification-and-checklist': 'validation-done',
  'stack-and-design': 'constraints-decisions',
  product: 'scope-non-goals',
  routes: 'functional-requirements',
  navigation: 'user-experience',
  screens: 'user-experience',
  'data-and-integrations': 'data-apis-integrations',
  'identity-and-ownership': 'security-privacy-permissions',
  'theme-responsive-ui-and-accessibility': 'user-experience',
  'storage-and-security': 'security-privacy-permissions',
  'scripts-tests-and-documentation': 'validation-done',
  completion: 'validation-done',
} as const satisfies Record<string, PrdTemplateSectionId>;
