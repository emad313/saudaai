import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

const docGroups = [
  {
    label: 'Start here',
    docs: [
      { slug: 'guide', title: 'Setting up your shop', file: 'docs/GUIDE.md' },
      { slug: 'readme', title: 'What SaudaAI is', file: 'README.md' },
    ],
  },
  {
    label: 'How it works',
    docs: [
      { slug: 'prd', title: 'Product', file: 'docs/PRD.md' },
      { slug: 'architecture', title: 'Architecture', file: 'docs/ARCHITECTURE.md' },
      { slug: 'agent', title: 'The assistant', file: 'docs/AGENT_SPEC.md' },
      { slug: 'stores', title: 'Store connectors', file: 'docs/STORE_CONNECTORS.md' },
      { slug: 'channels', title: 'Chat channels', file: 'docs/CHANNELS.md' },
      { slug: 'widget', title: 'Website chat widget', file: 'docs/WIDGET.md' },
      { slug: 'analytics', title: 'Analytics', file: 'docs/ANALYTICS.md' },
      { slug: 'models', title: 'Meta models', file: 'docs/MODEL_INTEGRATION.md' },
      { slug: 'data', title: 'Data model', file: 'docs/DATA_MODEL.md' },
      { slug: 'api', title: 'API', file: 'docs/API_SPEC.md' },
      { slug: 'setup', title: 'Accounts and keys', file: 'docs/SETUP.md' },
    ],
  },
  {
    label: 'The build',
    docs: [
      { slug: 'status', title: 'Status', file: 'docs/STATUS.md' },
      { slug: 'plan', title: 'Build plan', file: 'docs/BUILD_PLAN.md' },
      { slug: 'log', title: 'Build log', file: 'docs/BUILD_LOG.md' },
      { slug: 'demo', title: 'Demo script', file: 'docs/DEMO_SCRIPT.md' },
      { slug: 'submission', title: 'Submission', file: 'docs/SUBMISSION.md' },
    ],
  },
]

const bySlug = new Map(docGroups.flatMap((g) => g.docs).map((d) => [d.slug, d]))

// A deploy built from the public repository may not carry every doc; list only the ones present.
export function availableDocs() {
  return docGroups
    .map((g) => ({
      label: g.label,
      docs: g.docs
        .filter((d) => existsSync(resolve(root, d.file)))
        .map(({ slug, title }) => ({ slug, title })),
    }))
    .filter((g) => g.docs.length)
}

export async function readDoc(slug: string) {
  const doc = bySlug.get(slug)
  if (!doc || !existsSync(resolve(root, doc.file))) return null
  return { title: doc.title, markdown: await readFile(resolve(root, doc.file), 'utf8') }
}
