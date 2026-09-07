export const HANDOFF_CHECKLIST_HEADING = '## Before you hand it off';
export const HANDOFF_CHECKLIST_ITEM_COUNT = 7;
export const HANDOFF_CHECKLIST_DOWNLOAD_PATH =
  '/downloads/prd-handoff-checklist.md';
export const HANDOFF_CHECKLIST_FILENAME = 'prd-handoff-checklist.md';
export const HANDOFF_CHECKLIST_MIME = 'text/markdown; charset=utf-8';

const TASK_ITEM_PREFIX = '- [ ] ';

export const extractHandoffChecklistItems = (
  guideSource: string,
): readonly string[] => {
  const lines = guideSource.replace(/\r\n?/g, '\n').split('\n');
  const headingIndex = lines.indexOf(HANDOFF_CHECKLIST_HEADING);
  if (headingIndex === -1) {
    throw new Error(
      `Handoff checklist: missing "${HANDOFF_CHECKLIST_HEADING}" heading.`,
    );
  }

  let blockStart = headingIndex + 1;
  while (lines[blockStart] === '') blockStart += 1;
  if (blockStart >= lines.length) {
    throw new Error('Handoff checklist: the heading has no following block.');
  }

  const items: string[] = [];
  for (
    let lineIndex = blockStart;
    lineIndex < lines.length && lines[lineIndex] !== '';
    lineIndex += 1
  ) {
    const line = lines[lineIndex]!;
    if (/^#{1,6}(?:\s|$)/.test(line)) {
      throw new Error(
        `Handoff checklist: encountered a section boundary on line ${lineIndex + 1}.`,
      );
    }
    if (!line.startsWith(TASK_ITEM_PREFIX)) {
      throw new Error(
        `Handoff checklist: line ${lineIndex + 1} is not an unchecked Markdown task-list item.`,
      );
    }

    const item = line.slice(TASK_ITEM_PREFIX.length);
    if (item.trim() === '') {
      throw new Error(
        `Handoff checklist: item on line ${lineIndex + 1} is blank.`,
      );
    }
    items.push(item);
  }

  if (items.length !== HANDOFF_CHECKLIST_ITEM_COUNT) {
    throw new Error(
      `Handoff checklist: expected exactly ${HANDOFF_CHECKLIST_ITEM_COUNT} task-list items, found ${items.length}.`,
    );
  }

  return Object.freeze(items);
};

export const serializeHandoffChecklist = (
  items: readonly string[],
): string => {
  if (items.length !== HANDOFF_CHECKLIST_ITEM_COUNT) {
    throw new Error(
      `Handoff checklist: cannot serialize ${items.length} items; expected ${HANDOFF_CHECKLIST_ITEM_COUNT}.`,
    );
  }

  return (
    items
      .map((item, index) => {
        if (item.trim() === '') {
          throw new Error(
            `Handoff checklist: cannot serialize blank item ${index + 1}.`,
          );
        }
        if (/[\r\n]/.test(item)) {
          throw new Error(
            `Handoff checklist: item ${index + 1} contains a line break.`,
          );
        }
        return `${TASK_ITEM_PREFIX}${item}`;
      })
      .join('\n') + '\n'
  );
};
