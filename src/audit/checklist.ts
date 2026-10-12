/** Manual audit checklist items (physical / evidence checks). */
export const CHECKLIST_KEYS = [
  'grounding_bonding',
  'cord_condition',
  'labels',
  'pdu_mounting',
  'airflow_unobstructed',
  'blanking_installed',
  'front_rear_arrangement',
  'humidity',
  'cable_management',
  'connector_retention',
] as const;

export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];
