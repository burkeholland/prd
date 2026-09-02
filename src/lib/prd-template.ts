export interface PrdTemplateSection {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly helperQuestions?: readonly string[];
  readonly defaultValue: string;
}

export const PRD_TEMPLATE_SECTIONS = [
  {
    id: 'summary-outcome',
    title: 'Product summary and desired outcome',
    prompt: 'Summarize the product, who it is for, and the outcome this work should produce.',
    helperQuestions: [
      'What will exist when this work is complete?',
      'What change should the product create for its users?',
    ],
    defaultValue: '',
  },
  {
    id: 'context-problem',
    title: 'Context and problem',
    prompt: 'Describe the current situation, the problem to solve, and the evidence or assumptions that explain why it matters now.',
    helperQuestions: [
      'What happens today?',
      'What pain, risk, or opportunity makes this work worthwhile?',
    ],
    defaultValue: '',
  },
  {
    id: 'goals-success',
    title: 'Goals and success measures',
    prompt: 'State the goals and the observable measures that will show whether the product achieved them.',
    helperQuestions: [
      'Which outcomes should improve?',
      'What signals, targets, or timeframes define success?',
    ],
    defaultValue: '',
  },
  {
    id: 'users-use-cases',
    title: 'Users and important use cases',
    prompt: 'Identify the users who matter for this work and the important tasks or journeys each needs to complete.',
    helperQuestions: [
      'Who uses, administers, or is affected by the product?',
      'Which use cases must work at launch?',
    ],
    defaultValue: '',
  },
  {
    id: 'scope-non-goals',
    title: 'Scope and non-goals',
    prompt: 'Define what this work includes, what it deliberately excludes, and where its boundaries sit.',
    helperQuestions: [
      'Which capabilities belong in this release?',
      'Which plausible additions should not be built?',
    ],
    defaultValue: '',
  },
  {
    id: 'user-experience',
    title: 'User experience',
    prompt: 'Describe the screens, interactions, states, responsive behavior, and accessibility decisions users should experience.',
    helperQuestions: [
      'What do users see and do from start to finish?',
      'How should loading, empty, error, success, and small-screen states behave?',
    ],
    defaultValue: '',
  },
  {
    id: 'functional-requirements',
    title: 'Functional requirements',
    prompt: 'List observable product behavior, using exact labels, values, ordering, limits, and fallback rules where those details matter.',
    helperQuestions: [
      'What can a person or automated test observe?',
      'Which strings, numbers, precedence rules, or edge cases must be exact?',
    ],
    defaultValue: '',
  },
  {
    id: 'data-apis-integrations',
    title: 'Data, APIs, and external integrations',
    prompt: 'Specify the data the product reads or writes, its API contracts, and each external system interaction.',
    helperQuestions: [
      'What data is stored, generated, imported, or shared?',
      'How should integration failures, limits, and retries behave?',
    ],
    defaultValue: '',
  },
  {
    id: 'constraints-decisions',
    title: 'Constraints and fixed implementation decisions',
    prompt: 'Record the constraints and implementation choices that are fixed, plus alternatives that remain open or are ruled out.',
    helperQuestions: [
      'Which technology, compatibility, budget, timing, or operating constraints apply?',
      'Which decisions must not drift during implementation?',
    ],
    defaultValue: '',
  },
  {
    id: 'security-privacy-permissions',
    title: 'Security, privacy, identity, and permissions',
    prompt: 'Define applicable security, privacy, identity, permission, and trust-boundary decisions, including how untrusted input is handled.',
    helperQuestions: [
      'Who may see or change each resource?',
      'Where does trusted data end and untrusted data begin?',
    ],
    defaultValue: '',
  },
  {
    id: 'acceptance-recovery',
    title: 'Acceptance criteria and failure recovery',
    prompt: 'Write pass-or-fail acceptance criteria and define expected behavior when operations fail, time out, or need recovery.',
    helperQuestions: [
      'What must be true for this work to be accepted?',
      'What should users see and do after a failure?',
    ],
    defaultValue: '',
  },
  {
    id: 'validation-done',
    title: 'Validation plan and definition of done',
    prompt: 'Name the runnable commands, end-to-end journeys, and other evidence that define a complete and validated result.',
    helperQuestions: [
      'Which checks prove individual requirements?',
      'Which complete journeys, environments, or restart checks must pass?',
    ],
    defaultValue: '',
  },
] as const satisfies readonly PrdTemplateSection[];

export type PrdTemplateSectionId = (typeof PRD_TEMPLATE_SECTIONS)[number]['id'];

export interface PrdTemplateState {
  readonly title: string;
  readonly values: Readonly<Record<PrdTemplateSectionId, string>>;
}

export interface PrdTemplateStateInput {
  readonly title?: string | null;
  readonly values?: Readonly<Partial<Record<PrdTemplateSectionId, string | null | undefined>>>;
}

export interface SerializePrdMarkdownOptions {
  readonly blankPlaceholders?: boolean;
}

export interface PrdTemplateDocumentSection {
  readonly id: PrdTemplateSectionId;
  readonly title: string;
  readonly body: string;
}

export interface PrdTemplateDocument {
  readonly title: string;
  readonly sections: readonly PrdTemplateDocumentSection[];
}

export const PRD_TEMPLATE = {
  defaultTitle: 'Product requirements document',
  guidance:
    'Use these sections as a starting point. Change, remove, reorder, or skip them when they do not apply.',
  sections: PRD_TEMPLATE_SECTIONS,
} as const;

export const normalizePrdLineEndings = (value: string): string =>
  value.replace(/\r\n?/g, '\n');

export const normalizePrdTitle = (title: string | null | undefined): string => {
  const normalized = normalizePrdLineEndings(title ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  return normalized || PRD_TEMPLATE.defaultTitle;
};

export const normalizePrdSectionValue = (
  value: string | null | undefined,
): string => normalizePrdLineEndings(value ?? '').trim();

export const createBlankPrdTemplateState = (
  title: string = PRD_TEMPLATE.defaultTitle,
): PrdTemplateState => ({
  title,
  values: Object.fromEntries(
    PRD_TEMPLATE.sections.map((section) => [section.id, section.defaultValue]),
  ) as Record<PrdTemplateSectionId, string>,
});

export const createPrdTemplateDocument = (
  state: PrdTemplateStateInput,
  options: SerializePrdMarkdownOptions = {},
): PrdTemplateDocument => ({
  title: normalizePrdTitle(state.title),
  sections: PRD_TEMPLATE.sections.map((section) => {
    const value = normalizePrdSectionValue(state.values?.[section.id]);
    return {
      id: section.id,
      title: section.title,
      body: value || (options.blankPlaceholders ? `{${section.title}}` : ''),
    };
  }),
});

export const serializePrdMarkdown = (
  state: PrdTemplateStateInput,
  options: SerializePrdMarkdownOptions = {},
): string => {
  const document = createPrdTemplateDocument(state, options);
  const sections = document.sections.map((section) => {
    return `## ${section.title}${section.body ? `\n\n${section.body}` : ''}`;
  });

  return [`# ${document.title}`, ...sections].join('\n\n') + '\n';
};

export const serializeBlankPrdMarkdown = (
  title: string = PRD_TEMPLATE.defaultTitle,
): string =>
  serializePrdMarkdown(createBlankPrdTemplateState(title), {
    blankPlaceholders: true,
  });
