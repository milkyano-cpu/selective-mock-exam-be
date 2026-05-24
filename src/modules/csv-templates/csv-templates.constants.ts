export const CSV_TEMPLATE_TYPE_VALUES = [
  "question-mcq",
  "question-essay",
  "passages",
  "ai-rubric-criteria",
  "ai-rubric-band-descriptors",
  "ai-calibration-notes",
] as const;

export type CsvTemplateType = (typeof CSV_TEMPLATE_TYPE_VALUES)[number];

export const CSV_TEMPLATE_DEFINITIONS: Array<{
  type: CsvTemplateType;
  label: string;
  fileName: string;
}> = [
  {
    type: "question-mcq",
    label: "Question MCQ",
    fileName: "question-mcq-template.csv",
  },
  {
    type: "question-essay",
    label: "Question Essay",
    fileName: "question-essay-template.csv",
  },
  {
    type: "passages",
    label: "Passages",
    fileName: "passages-template.csv",
  },
  {
    type: "ai-rubric-criteria",
    label: "AI Rubric Criteria",
    fileName: "ai-rubric-criteria-template.csv",
  },
  {
    type: "ai-rubric-band-descriptors",
    label: "AI Rubric Band Descriptors",
    fileName: "ai-rubric-band-descriptors-template.csv",
  },
  {
    type: "ai-calibration-notes",
    label: "AI Calibration Notes",
    fileName: "ai-calibration-notes-template.csv",
  },
];

const CSV_TEMPLATE_DEFINITION_BY_TYPE = new Map(
  CSV_TEMPLATE_DEFINITIONS.map((definition) => [definition.type, definition])
);

export function getCsvTemplateDefinition(type: string) {
  return CSV_TEMPLATE_DEFINITION_BY_TYPE.get(type as CsvTemplateType) ?? null;
}
