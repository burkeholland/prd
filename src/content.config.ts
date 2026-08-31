import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Authored markdown lives in the repo-root `content/` folder (not `src/content/`).
// The folder is owned by other tasks and may be absent; the glob loader only warns.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: './content' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().optional(),
  }),
});

// Snapshot of the gist. The file has no frontmatter, so nothing is required.
const gist = defineCollection({
  loader: glob({ pattern: '*.md', base: './content/gist' }),
  schema: z.object({}).passthrough(),
});

export const collections = { docs, gist };
