import { readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { SVG } from 'mathjax-full/js/output/svg.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Revisions are discovered from `whitepaper/v<major>.<minor>.md` rather than
 * listed, so adding a revision is one file and `latest` cannot drift behind it.
 * Each revision answers to both `v0.6` and `0.6`.
 */
const whitepaperRevisions = readdirSync(path.join(root, 'whitepaper'))
  .map((name) => /^v(\d+)\.(\d+)\.md$/.exec(name))
  .filter((match) => match !== null)
  .map((match) => ({
    file: `whitepaper/${match[0]}`,
    label: match[0].slice(0, -3),
    order: Number(match[1]) * 1000 + Number(match[2])
  }))
  .sort((a, b) => a.order - b.order)

if (whitepaperRevisions.length === 0) {
  throw new Error('No whitepaper revisions found: expected whitepaper/v<major>.<minor>.md')
}

const whitepaperVersions = new Map([
  ...whitepaperRevisions.flatMap(({ file, label }) => [
    [label, file],
    [label.slice(1), file]
  ]),
  ['latest', whitepaperRevisions.at(-1).file]
])
const defaultOutputPath = 'whitepaper/index.html'
const mathAdaptor = liteAdaptor()

RegisterHTMLHandler(mathAdaptor)

const mathDocument = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' })
})

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    console.log(renderUsage())
    return
  }

  const sourcePath = resolveSourcePath(options)
  const outputPath = path.resolve(root, options.out || defaultOutputPath)
  const sourceHref = getSourceHref(sourcePath, outputPath)
  const source = await readFile(sourcePath, 'utf8')
  const { frontmatter, body } = stripFrontmatter(source)
  const blocks = parseBlocks(body)

  const titleBlockIndex = blocks.findIndex((block) => block.type === 'heading' && block.level === 1)
  const title = titleBlockIndex >= 0 ? blocks[titleBlockIndex].text : frontmatter.title || 'Pop Charts White Paper'

  const abstractHeadingIndex = blocks.findIndex(
    (block) => block.type === 'heading' && block.level === 2 && /^abstract$/i.test(block.text)
  )
  const titleMetaStart = titleBlockIndex >= 0 ? titleBlockIndex + 1 : 0
  const titleMetaEnd = abstractHeadingIndex >= 0 ? abstractHeadingIndex : titleMetaStart
  const titleMetadata = normalizeTitleMetadata(blocks.slice(titleMetaStart, titleMetaEnd))
  const abstractEndIndex = abstractHeadingIndex >= 0
    ? findNextHeading(blocks, abstractHeadingIndex + 1, 2)
    : -1

  const abstractBlocks = abstractHeadingIndex >= 0
    ? blocks.slice(abstractHeadingIndex + 1, abstractEndIndex === -1 ? blocks.length : abstractEndIndex)
    : []
  const mainBlocks = blocks.filter((block, index) => {
    if (index === titleBlockIndex) return false
    if (index >= titleMetaStart && index < titleMetaEnd) return false
    if (abstractHeadingIndex >= 0 && index >= abstractHeadingIndex && (abstractEndIndex === -1 || index < abstractEndIndex)) {
      return false
    }
    return true
  })

  const html = renderDocument({
    title,
    description: frontmatter.description || 'Pop Charts whitepaper',
    titleMetadata,
    abstractHtml: renderBlocks(abstractBlocks),
    bodyHtml: renderBlocks(mainBlocks),
    sourcePath: path.relative(root, sourcePath),
    sourceHref,
    generatedAt: new Date().toISOString()
  })

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, html)

  console.log(`Wrote ${path.relative(root, outputPath)} from ${path.relative(root, sourcePath)}`)
}

function parseCliArgs(args) {
  const options = {
    version: 'latest',
    source: '',
    out: ''
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--version' || arg === '-v') {
      options.version = requireValue(args, index, arg)
      index += 1
      continue
    }

    if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length)
      continue
    }

    if (arg === '--source') {
      options.source = requireValue(args, index, arg)
      index += 1
      continue
    }

    if (arg.startsWith('--source=')) {
      options.source = arg.slice('--source='.length)
      continue
    }

    if (arg === '--out' || arg === '-o') {
      options.out = requireValue(args, index, arg)
      index += 1
      continue
    }

    if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length)
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}\n\n${renderUsage()}`)
    }

    options.version = arg
  }

  return options
}

function requireValue(args, index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}\n\n${renderUsage()}`)
  }
  return value
}

function resolveSourcePath(options) {
  if (options.source) {
    return path.resolve(root, options.source)
  }

  const source = whitepaperVersions.get(options.version)
  if (!source) {
    const versions = Array.from(new Set(whitepaperVersions.keys())).join(', ')
    throw new Error(`Unknown whitepaper version "${options.version}". Known versions: ${versions}`)
  }

  return path.join(root, source)
}

function getSourceHref(sourcePath, outputPath) {
  const sourceRelative = path.relative(path.join(root, 'whitepaper'), sourcePath)
  const outputRelative = path.relative(path.join(root, 'whitepaper'), outputPath)

  if (
    sourceRelative.startsWith('..') ||
    outputRelative.startsWith('..') ||
    path.isAbsolute(sourceRelative) ||
    path.isAbsolute(outputRelative) ||
    !sourceRelative.endsWith('.md')
  ) {
    return ''
  }

  return path
    .relative(path.dirname(outputPath), sourcePath)
    .replaceAll(path.sep, '/')
}

function renderUsage() {
  const newest = whitepaperRevisions.at(-1).label
  const known = whitepaperRevisions.map(({ label }) => label).join(', ')
  return `Usage:
  node whitepaper/build.mjs [version]
  node whitepaper/build.mjs --version ${newest}
  node whitepaper/build.mjs --source whitepaper/${newest}.md

Options:
  -v, --version <version>  Whitepaper revision: ${known}, latest (currently ${newest}).
                           The leading "v" is optional.
  --source <path>         Markdown source path, relative to the repo root.
  -o, --out <path>        Output HTML path. Defaults to ${defaultOutputPath}.
  -h, --help              Show this help text.`
}

function normalizeTitleMetadata(blocks) {
  return blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text.replace(/^Research date:\s*/i, '').trim())
    .filter(Boolean)
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---')) {
    return { frontmatter: {}, body: markdown }
  }

  const end = markdown.indexOf('\n---', 3)
  if (end === -1) {
    return { frontmatter: {}, body: markdown }
  }

  const raw = markdown.slice(3, end).trim()
  const frontmatter = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match) {
      frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
    }
  }

  return { frontmatter, body: markdown.slice(end + 4).replace(/^\n/, '') }
}

function parseBlocks(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2].trim()
      })
      index += 1
      continue
    }

    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim() || 'text'
      const code = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', lang, text: code.join('\n') })
      index += 1
      continue
    }

    if (isTableStart(lines, index)) {
      const tableLines = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'table', rows: parseTable(tableLines) })
      continue
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const items = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: true, items })
      continue
    }

    if (/^-\s+/.test(line.trim())) {
      const items = []
      while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^-\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered: false, items })
      continue
    }

    const paragraph = [line.trim()]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !lines[index].trim().startsWith('```') &&
      !isTableStart(lines, index) &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !/^-\s+/.test(lines[index].trim())
    ) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
  }

  return blocks
}

function isTableStart(lines, index) {
  if (!lines[index]?.trim().startsWith('|')) return false
  const separator = lines[index + 1]?.trim()
  return Boolean(separator && /^\|?[\s:-]*-{3,}[\s|:-]*$/.test(separator))
}

function parseTable(lines) {
  const header = splitTableRow(lines[0])
  const rows = lines.slice(2).map(splitTableRow)
  return { header, rows }
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function findNextHeading(blocks, startIndex, maxLevel) {
  const next = blocks.findIndex(
    (block, index) => index >= startIndex && block.type === 'heading' && block.level <= maxLevel
  )
  return next === -1 ? -1 : next
}

function renderDocument({ title, description, titleMetadata, abstractHtml, bodyHtml, sourcePath, sourceHref, generatedAt }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <style>${renderCss()}</style>
</head>
<body>
  <div class="reader-actions" aria-label="Whitepaper actions">
    ${sourceHref ? `<a href="${escapeHtml(sourceHref)}">Source Markdown</a>` : ''}
    <button type="button" onclick="window.print()">Print / Save PDF</button>
  </div>
  <main class="paper-shell">
    <article class="paper">
      <header class="paper-title">
        <p class="paper-kicker">Pop Charts Research</p>
        <h1>${renderInline(title)}</h1>
        ${renderTitleMetadata(titleMetadata)}
      </header>
      <section class="paper-abstract" aria-labelledby="abstract">
        <h2 id="abstract">Abstract</h2>
        ${abstractHtml}
      </section>
      <div class="paper-columns">
        ${bodyHtml}
      </div>
    </article>
  </main>
  <footer class="build-note">
    Generated from ${escapeHtml(sourcePath)} at ${escapeHtml(generatedAt)}.
  </footer>
</body>
</html>
`
}

function renderTitleMetadata(titleMetadata) {
  const metadata = titleMetadata.length > 0 ? titleMetadata : ['Pop Charts']
  return `<div class="paper-meta">
${metadata.map((line) => `<p>${renderInline(line)}</p>`).join('\n')}
        </div>`
}

function renderBlocks(blocks) {
  return blocks.map(renderBlock).join('\n')
}

function renderBlock(block) {
  if (block.type === 'heading') {
    const id = slugify(block.text)
    return `<h${block.level} id="${id}">${renderInline(block.text)}</h${block.level}>`
  }

  if (block.type === 'paragraph') {
    return `<p>${renderInline(block.text)}</p>`
  }

  if (block.type === 'list') {
    const tag = block.ordered ? 'ol' : 'ul'
    const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join('\n')
    return `<${tag}>\n${items}\n</${tag}>`
  }

  if (block.type === 'table') {
    const header = block.rows.header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
    const rows = block.rows.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
      .join('\n')
    return `<figure class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></figure>`
  }

  if (block.type === 'code') {
    const language = block.lang.toLowerCase()
    if (language === 'math' || language === 'tex' || language === 'latex') {
      return `<figure class="math-block">${renderMath(block.text.trim())}</figure>`
    }

    if (language === 'json') {
      return `<figure class="code-listing"><figcaption>Market rule schema</figcaption><pre><code>${escapeHtml(block.text)}</code></pre></figure>`
    }

    if (language === 'price-chart') {
      return renderPriceChart(block.text)
    }

    const tex = toTex(block.text)
    if (tex) {
      return `<figure class="math-block">${renderMath(tex)}</figure>`
    }

    return `<figure class="note-block"><pre>${escapeHtml(block.text)}</pre></figure>`
  }

  return ''
}

const texBlocks = new Map([
  [
    `YES pays 1 if the event resolves YES.\nNO pays 1 if the event resolves NO.`,
    String.raw`\begin{aligned}
\mathrm{YES} &\mapsto 1 && \text{if the event resolves YES} \\
\mathrm{NO} &\mapsto 1 && \text{if the event resolves NO}
\end{aligned}`
  ],
  [
    `1 YES + 1 NO = 1 unit of collateral`,
    String.raw`1\,\mathrm{YES} + 1\,\mathrm{NO} = 1\,\text{unit of collateral}`
  ],
  [
    `C(q_yes, q_no) = b * ln(exp(q_yes / b) + exp(q_no / b))`,
    String.raw`C(q_{\mathrm{yes}}, q_{\mathrm{no}})=b\ln\left(e^{q_{\mathrm{yes}}/b}+e^{q_{\mathrm{no}}/b}\right)`
  ],
  [
    `P_yes = exp(q_yes / b) / (exp(q_yes / b) + exp(q_no / b))`,
    String.raw`P_{\mathrm{yes}}=\frac{e^{q_{\mathrm{yes}}/b}}{e^{q_{\mathrm{yes}}/b}+e^{q_{\mathrm{no}}/b}}`
  ],
  [
    `dC/dq_yes\n= b * (1 / (exp(q_yes / b) + exp(q_no / b))) * (1 / b) * exp(q_yes / b)\n= exp(q_yes / b) / (exp(q_yes / b) + exp(q_no / b))`,
    String.raw`\begin{aligned}
\frac{dC}{dq_{\mathrm{yes}}}
&= b\left(\frac{1}{e^{q_{\mathrm{yes}}/b}+e^{q_{\mathrm{no}}/b}}\right)\left(\frac{1}{b}\right)e^{q_{\mathrm{yes}}/b} \\
&= \frac{e^{q_{\mathrm{yes}}/b}}{e^{q_{\mathrm{yes}}/b}+e^{q_{\mathrm{no}}/b}}
\end{aligned}`
  ],
  [
    `P_no = 1 - P_yes`,
    String.raw`P_{\mathrm{no}}=1-P_{\mathrm{yes}}`
  ],
  [
    `cost = C(q_after) - C(q_before)`,
    String.raw`\mathrm{cost}=C(q_{\mathrm{after}})-C(q_{\mathrm{before}})`
  ],
  [
    `cost_yes(s) = integral from 0 to s of P_yes(q_yes + x, q_no) dx\n            = C(q_yes + s, q_no) - C(q_yes, q_no)`,
    String.raw`\begin{aligned}
\mathrm{cost}_{\mathrm{yes}}(s)
&= \int_0^s P_{\mathrm{yes}}(q_{\mathrm{yes}}+x,q_{\mathrm{no}})\,dx \\
&= C(q_{\mathrm{yes}}+s,q_{\mathrm{no}})-C(q_{\mathrm{yes}},q_{\mathrm{no}})
\end{aligned}`
  ],
  [
    `1 retained YES pays 1 if YES resolves true.\n1 retained NO pays 1 if NO resolves true.`,
    String.raw`\begin{aligned}
1\,\text{retained YES} &\mapsto 1 && \text{if YES resolves true} \\
1\,\text{retained NO} &\mapsto 1 && \text{if NO resolves true}
\end{aligned}`
  ],
  [
    `price ~= implied probability`,
    String.raw`\mathrm{price}\approx\text{implied probability}`
  ],
  [
    `p_yes + p_no >= 1`,
    String.raw`p_{\mathrm{yes}}+p_{\mathrm{no}}\ge 1`
  ],
  [
    `side_l in {YES, NO}\ns_l = provisional shares\nc_l = cost basis\np_l = c_l / s_l`,
    String.raw`\begin{aligned}
\mathrm{side}_l &\in \{\mathrm{YES},\mathrm{NO}\} \\
s_l &= \text{provisional shares} \\
c_l &= \text{cost basis} \\
p_l &= \frac{c_l}{s_l}
\end{aligned}`
  ],
  [
    `Y = sum YES shares\nN = sum NO shares\nC_y = sum YES cost basis\nC_n = sum NO cost basis`,
    String.raw`\begin{aligned}
Y &= \sum \text{YES shares} \\
N &= \sum \text{NO shares} \\
C_y &= \sum \text{YES cost basis} \\
C_n &= \sum \text{NO cost basis}
\end{aligned}`
  ],
  [
    `q_yes = Y\nq_no = N`,
    String.raw`\begin{aligned}
q_{\mathrm{yes}} &= Y \\
q_{\mathrm{no}} &= N
\end{aligned}`
  ],
  [
    `q_yes = q_yes_0 + Y\nq_no = q_no_0 + N`,
    String.raw`\begin{aligned}
q_{\mathrm{yes}} &= q_{\mathrm{yes},0}+Y \\
q_{\mathrm{no}} &= q_{\mathrm{no},0}+N
\end{aligned}`
  ],
  [
    `P0 = exp(q_yes_0 / b) / (exp(q_yes_0 / b) + exp(q_no_0 / b))\nq_yes_0 - q_no_0 = b * ln(P0 / (1 - P0))`,
    String.raw`\begin{aligned}
P_0 &= \frac{e^{q_{\mathrm{yes},0}/b}}{e^{q_{\mathrm{yes},0}/b}+e^{q_{\mathrm{no},0}/b}} \\
q_{\mathrm{yes},0}-q_{\mathrm{no},0} &= b\ln\left(\frac{P_0}{1-P_0}\right)
\end{aligned}`
  ],
  [
    `q_before = (q_yes, q_no)\nq_after = (q_yes + s_l, q_no)\nc_l = C(q_after) - C(q_before)\np_l = c_l / s_l`,
    String.raw`\begin{aligned}
q_{\mathrm{before}} &= (q_{\mathrm{yes}},q_{\mathrm{no}}) \\
q_{\mathrm{after}} &= (q_{\mathrm{yes}}+s_l,q_{\mathrm{no}}) \\
c_l &= C(q_{\mathrm{after}})-C(q_{\mathrm{before}}) \\
p_l &= \frac{c_l}{s_l}
\end{aligned}`
  ],
  [
    `q_before = (q_yes, q_no)\nq_after = (q_yes, q_no + s_l)\nc_l = C(q_after) - C(q_before)\np_l = c_l / s_l`,
    String.raw`\begin{aligned}
q_{\mathrm{before}} &= (q_{\mathrm{yes}},q_{\mathrm{no}}) \\
q_{\mathrm{after}} &= (q_{\mathrm{yes}},q_{\mathrm{no}}+s_l) \\
c_l &= C(q_{\mathrm{after}})-C(q_{\mathrm{before}}) \\
p_l &= \frac{c_l}{s_l}
\end{aligned}`
  ],
  [
    `A = exp(q_yes / b)\nB = exp(q_no / b)`,
    String.raw`\begin{aligned}
A &= e^{q_{\mathrm{yes}}/b} \\
B &= e^{q_{\mathrm{no}}/b}
\end{aligned}`
  ],
  [
    `c = b * ln((A * exp(s / b) + B) / (A + B))\nexp(c / b) * (A + B) = A * exp(s / b) + B\nexp(s / b) = (exp(c / b) * (A + B) - B) / A\ns = b * ln((exp(c / b) * (A + B) - B) / A)`,
    String.raw`\begin{aligned}
c &= b\ln\left(\frac{Ae^{s/b}+B}{A+B}\right) \\
e^{c/b}(A+B) &= Ae^{s/b}+B \\
e^{s/b} &= \frac{e^{c/b}(A+B)-B}{A} \\
s &= b\ln\left(\frac{e^{c/b}(A+B)-B}{A}\right)
\end{aligned}`
  ],
  [
    `s = b * ln((exp(c / b) * (A + B) - A) / B)`,
    String.raw`s=b\ln\left(\frac{e^{c/b}(A+B)-A}{B}\right)`
  ],
  [
    `p_y + p_n >= 1`,
    String.raw`p_y+p_n\ge 1`
  ],
  [
    `1 YES outcome token + 1 NO outcome token = 1 unit of collateral`,
    String.raw`\begin{aligned}
1\,\text{YES outcome token}+1\,\text{NO outcome token}
&=1\,\text{unit of collateral}
\end{aligned}`
  ],
  [
    `YES collateral = f * p_y\nNO collateral = f * p_n\ntotal contributed = f * (p_y + p_n)`,
    String.raw`\begin{aligned}
\text{YES collateral} &= fp_y \\
\text{NO collateral} &= fp_n \\
\text{total contributed} &= f(p_y+p_n)
\end{aligned}`
  ],
  [
    `required collateral = f`,
    String.raw`\text{required collateral}=f`
  ],
  [
    `f * (p_y + p_n) >= f\np_y + p_n >= 1`,
    String.raw`\begin{aligned}
f(p_y+p_n)&\ge f \\
p_y+p_n&\ge 1
\end{aligned}`
  ],
  [
    `p_y + p_n < 1`,
    String.raw`p_y+p_n<1`
  ],
  [
    `f = min(yes_shares_remaining, no_shares_remaining)`,
    String.raw`f=\min(\text{YES shares remaining},\text{NO shares remaining})`
  ],
  [
    `collateral_pair = f * (p_y + p_n)`,
    String.raw`\mathrm{collateral}_{\mathrm{pair}}=f(p_y+p_n)`
  ],
  [
    `required_pair = f`,
    String.raw`\mathrm{required}_{\mathrm{pair}}=f`
  ],
  [
    `surplus_pair = f * (p_y + p_n - 1)`,
    String.raw`\mathrm{surplus}_{\mathrm{pair}}=f(p_y+p_n-1)`
  ],
  [
    `F = sum matched f`,
    String.raw`F=\sum \text{matched } f`
  ],
  [
    `F >= graduation_threshold`,
    String.raw`F\ge \mathrm{graduation}_{\mathrm{threshold}}`
  ],
  [
    `retained_yes = f\nmax_retained_cost = f * p_y`,
    String.raw`\begin{aligned}
\mathrm{retained}_{\mathrm{yes}} &= f \\
\mathrm{max\ retained\ cost} &= fp_y
\end{aligned}`
  ],
  [
    `retained_no = f\nmax_retained_cost = f * p_n`,
    String.raw`\begin{aligned}
\mathrm{retained}_{\mathrm{no}} &= f \\
\mathrm{max\ retained\ cost} &= fp_n
\end{aligned}`
  ],
  [
    `effective_cost <= max_retained_cost`,
    String.raw`\mathrm{effective}_{\mathrm{cost}}\le \mathrm{max}_{\mathrm{retained\ cost}}`
  ],
  [
    `removed_shares = provisional_shares - retained_shares\nremoved_refund = removed_shares * entry_price`,
    String.raw`\begin{aligned}
\mathrm{removed}_{\mathrm{shares}} &= \mathrm{provisional}_{\mathrm{shares}}-\mathrm{retained}_{\mathrm{shares}} \\
\mathrm{removed}_{\mathrm{refund}} &= \mathrm{removed}_{\mathrm{shares}}\cdot\mathrm{entry}_{\mathrm{price}}
\end{aligned}`
  ],
  [
    `surplus_refund = retained_shares * price_improvement`,
    String.raw`\mathrm{surplus}_{\mathrm{refund}}=\mathrm{retained}_{\mathrm{shares}}\cdot\mathrm{price}_{\mathrm{improvement}}`
  ],
  [
    `refund = removed_refund + surplus_refund`,
    String.raw`\mathrm{refund}=\mathrm{removed}_{\mathrm{refund}}+\mathrm{surplus}_{\mathrm{refund}}`
  ],
  [
    `0 <= refund <= cost_basis\nretained_cost <= retained_shares\neffective_retained_price <= entry_price`,
    String.raw`\begin{aligned}
0 &\le \mathrm{refund}\le \mathrm{cost}_{\mathrm{basis}} \\
\mathrm{retained}_{\mathrm{cost}} &\le \mathrm{retained}_{\mathrm{shares}} \\
\mathrm{effective}_{\mathrm{retained\ price}} &\le \mathrm{entry}_{\mathrm{price}}
\end{aligned}`
  ],
  [
    `total_collateral_locked = F`,
    String.raw`\mathrm{total}_{\mathrm{collateral\ locked}}=F`
  ],
  [
    `A + C = 0.30 + 0.60 = 0.90  -> not compatible\nB + C = 0.40 + 0.60 = 1.00  -> compatible`,
    String.raw`\begin{aligned}
A+C&=0.30+0.60=0.90 && \text{not compatible} \\
B+C&=0.40+0.60=1.00 && \text{compatible}
\end{aligned}`
  ],
  [
    `f = min(100, 10) = 10`,
    String.raw`f=\min(100,10)=10`
  ],
  [
    `A refund = 100 * 0.30 = 30\nB removed shares = 90\nB refund = 90 * 0.40 = 36\nC refund = 0`,
    String.raw`\begin{aligned}
A_{\mathrm{refund}} &= 100\cdot 0.30=30 \\
B_{\mathrm{removed\ shares}} &= 90 \\
B_{\mathrm{refund}} &= 90\cdot 0.40=36 \\
C_{\mathrm{refund}} &= 0
\end{aligned}`
  ],
  [
    `B retained cost = 10 * 0.40 = 4\nC retained cost = 10 * 0.60 = 6\ntotal locked = 10`,
    String.raw`\begin{aligned}
B_{\mathrm{retained\ cost}} &= 10\cdot 0.40=4 \\
C_{\mathrm{retained\ cost}} &= 10\cdot 0.60=6 \\
\mathrm{total}_{\mathrm{locked}} &= 10
\end{aligned}`
  ],
  [
    `economic_exposure = F`,
    String.raw`\mathrm{economic}_{\mathrm{exposure}}=F`
  ]
])

function toTex(text) {
  return texBlocks.get(text.trim()) || ''
}

function renderMath(tex) {
  try {
    const node = mathDocument.convert(tex, { display: true })
    return mathAdaptor.outerHTML(node)
  } catch (error) {
    console.warn(`Math render failed: ${error.message}`)
    return `<pre>${escapeHtml(tex)}</pre>`
  }
}

const chartSeriesStyles = [
  { stroke: '#000000' },
  { stroke: '#5f5f5f' },
  { stroke: '#8a8a8a' },
  { stroke: '#2f2f2f' }
]

function renderPriceChart(raw) {
  try {
    const chart = JSON.parse(raw)
    const width = 640
    const height = 300
    const margin = { top: 34, right: 34, bottom: 58, left: 62 }
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom
    const yMin = toFiniteNumber(chart.yMin, 0)
    const yMax = toFiniteNumber(chart.yMax, 100)
    const ticks = normalizeTicks(chart.ticks, yMin, yMax)
    const xLabels = normalizeXLabels(chart)
    const xMax = Math.max(1, xLabels.length - 1)
    const ySpan = yMax === yMin ? 1 : yMax - yMin
    const xScale = (value) => margin.left + (toFiniteNumber(value, 0) / xMax) * plotWidth
    const yScale = (value) => margin.top + ((yMax - toFiniteNumber(value, yMin)) / ySpan) * plotHeight

    const grid = ticks.map((tick) => {
      const y = yScale(tick)
      return `<g class="price-chart-gridline"><line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width - margin.right}" y2="${y.toFixed(2)}"></line><text x="${margin.left - 10}" y="${(y + 4).toFixed(2)}">${escapeHtml(formatPercent(tick))}</text></g>`
    }).join('')

    const bands = Array.isArray(chart.bands)
      ? chart.bands.map((band) => renderChartBand({ band, margin, plotWidth, xScale, yScale })).join('')
      : ''

    const xAxisLabels = xLabels.map((label, index) => {
      const x = xScale(index)
      return `<text class="price-chart-x-label" x="${x.toFixed(2)}" y="${height - 24}">${escapeHtml(label)}</text>`
    }).join('')

    const series = Array.isArray(chart.series)
      ? chart.series.map((item, index) => renderChartSeries({ item, index, xScale, yScale })).join('')
      : ''
    const annotations = Array.isArray(chart.annotations)
      ? chart.annotations.map((annotation) => renderChartAnnotation({ annotation, xScale, yScale })).join('')
      : ''
    const markerDefs = annotations
      ? '<defs><marker id="price-chart-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 Z"></path></marker></defs>'
      : ''
    const defsMarkup = markerDefs ? `  ${markerDefs}\n` : ''

    const legend = Array.isArray(chart.series)
      ? chart.series.map((item, index) => {
        const style = chartSeriesStyles[index % chartSeriesStyles.length]
        const dash = item.style === 'dotted'
          ? 'border-top-style: dotted;'
          : item.style === 'dashed'
            ? 'border-top-style: dashed;'
            : ''
        return `<span><span class="price-chart-key" style="border-color:${style.stroke};${dash}"></span>${escapeHtml(item.label || `Series ${index + 1}`)}</span>`
      }).join('')
      : ''

    const title = chart.title
      ? `<figcaption>${renderInline(chart.title)}</figcaption>`
      : ''
    const caption = chart.caption
      ? `<p class="price-chart-caption">${renderInline(chart.caption)}</p>`
      : ''
    const yLabel = chart.yLabel
      ? `<text class="price-chart-y-label" transform="translate(18 ${margin.top + plotHeight / 2}) rotate(-90)">${escapeHtml(chart.yLabel)}</text>`
      : ''
    const bandMarkup = bands ? `  ${bands}\n` : ''

    return `<figure class="price-chart">
${title}
<svg class="price-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(chart.title || 'Price path chart')}">
${defsMarkup}
  <rect class="price-chart-bg" x="0" y="0" width="${width}" height="${height}"></rect>
${bandMarkup}
  ${grid}
  <line class="price-chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}"></line>
  <line class="price-chart-axis" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}"></line>
  ${xAxisLabels}
  ${yLabel}
  ${series}
  ${annotations}
</svg>
${legend ? `<div class="price-chart-legend">${legend}</div>` : ''}
${caption}
</figure>`
  } catch (error) {
    console.warn(`Price chart render failed: ${error.message}`)
    return `<figure class="note-block"><pre>${escapeHtml(raw)}</pre></figure>`
  }
}

function renderChartBand({ band, margin, plotWidth, xScale, yScale }) {
  const from = toFiniteNumber(band.from, 0)
  const to = toFiniteNumber(band.to, from)
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  const yTop = yScale(high)
  const yBottom = yScale(low)
  const xFrom = band.xFrom === undefined ? margin.left : xScale(band.xFrom)
  const xTo = band.xTo === undefined ? margin.left + plotWidth : xScale(band.xTo)
  const className = sanitizeClassName(band.className || band.kind || 'neutral')
  const label = band.label
    ? `<text class="price-chart-band-label" x="${(Math.max(xFrom, xTo) - 6).toFixed(2)}" y="${(yTop + 14).toFixed(2)}">${escapeHtml(band.label)}</text>`
    : ''

  return `<g class="price-chart-band price-chart-band-${className}"><rect x="${Math.min(xFrom, xTo).toFixed(2)}" y="${yTop.toFixed(2)}" width="${Math.abs(xTo - xFrom).toFixed(2)}" height="${Math.max(1, yBottom - yTop).toFixed(2)}"></rect>${label}</g>`
}

function renderChartSeries({ item, index, xScale, yScale }) {
  const points = Array.isArray(item.points)
    ? item.points.map(normalizeChartPoint).filter(Boolean)
    : []

  if (points.length === 0) return ''

  const style = chartSeriesStyles[index % chartSeriesStyles.length]
  const dash = item.style === 'dotted'
    ? '1 4'
    : item.style === 'dashed'
      ? '5 4'
      : ''
  const path = points
    .map((point, pointIndex) => {
      const x = xScale(point.x).toFixed(2)
      const y = yScale(point.y).toFixed(2)
      return `${pointIndex === 0 ? 'M' : 'L'}${x} ${y}`
    })
    .join(' ')
  const labels = points.map((point, pointIndex) => {
    const x = xScale(point.x)
    const y = yScale(point.y)
    const dy = pointIndex % 2 === 0 ? -11 : 18
    return `<text class="price-chart-point-label" x="${x.toFixed(2)}" y="${(y + dy).toFixed(2)}">${escapeHtml(point.label || formatPercent(point.y))}</text>`
  }).join('')
  const circles = points.map((point) => {
    const x = xScale(point.x)
    const y = yScale(point.y)
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.5"></circle>`
  }).join('')

  return `<g class="price-chart-series" style="--series-stroke:${style.stroke};--series-dash:${dash || 'none'};"><path d="${path}"></path>${circles}${labels}</g>`
}

function renderChartAnnotation({ annotation, xScale, yScale }) {
  const from = normalizeChartPosition(annotation.from)
  const to = normalizeChartPosition(annotation.to)
  if (!from || !to) return ''

  const x1 = xScale(from.x)
  const y1 = yScale(from.y)
  const x2 = xScale(to.x)
  const y2 = yScale(to.y)
  const labelAt = normalizeChartPosition(annotation.labelAt)
  const labelX = labelAt ? xScale(labelAt.x) : annotation.arrow ? x1 : (x1 + x2) / 2
  const labelY = labelAt ? yScale(labelAt.y) : annotation.arrow ? y1 : (y1 + y2) / 2
  const className = sanitizeClassName(annotation.kind || 'note')
  const marker = annotation.arrow ? ' marker-end="url(#price-chart-arrow)"' : ''
  const anchor = annotation.anchor || (annotation.arrow ? 'start' : 'middle')
  const label = annotation.label
    ? `<text x="${(labelX + toFiniteNumber(annotation.dx, 0)).toFixed(2)}" y="${(labelY + toFiniteNumber(annotation.dy, -6)).toFixed(2)}" text-anchor="${escapeAttribute(anchor)}">${escapeHtml(annotation.label)}</text>`
    : ''

  return `<g class="price-chart-annotation price-chart-annotation-${className}"><line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"${marker}></line>${label}</g>`
}

function normalizeChartPosition(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return {
      x: toFiniteNumber(value[0], 0),
      y: toFiniteNumber(value[1], 0)
    }
  }

  if (value && typeof value === 'object') {
    return {
      x: toFiniteNumber(value.x, 0),
      y: toFiniteNumber(value.y, 0)
    }
  }

  return null
}

function normalizeChartPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    return {
      x: toFiniteNumber(point[0], 0),
      y: toFiniteNumber(point[1], 0),
      label: point[2] ? String(point[2]) : ''
    }
  }

  if (point && typeof point === 'object') {
    return {
      x: toFiniteNumber(point.x, 0),
      y: toFiniteNumber(point.y, 0),
      label: point.label ? String(point.label) : ''
    }
  }

  return null
}

function normalizeXLabels(chart) {
  if (Array.isArray(chart.xLabels) && chart.xLabels.length > 0) {
    return chart.xLabels.map((label) => String(label))
  }

  const maxX = Array.isArray(chart.series)
    ? chart.series
      .flatMap((item) => Array.isArray(item.points) ? item.points : [])
      .map(normalizeChartPoint)
      .filter(Boolean)
      .reduce((maximum, point) => Math.max(maximum, Math.round(point.x)), 0)
    : 0

  return Array.from({ length: Math.max(2, maxX + 1) }, (_, index) => String(index))
}

function normalizeTicks(ticks, yMin, yMax) {
  if (Array.isArray(ticks) && ticks.length > 0) {
    return ticks.map((tick) => toFiniteNumber(tick, yMin))
  }

  const step = (yMax - yMin) / 4
  return Array.from({ length: 5 }, (_, index) => yMin + step * index)
}

function toFiniteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

function sanitizeClassName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'neutral'
}

function renderInline(raw) {
  const placeholders = []
  const hold = (html) => {
    const token = `@@HTML_${placeholders.length}@@`
    placeholders.push([token, html])
    return token
  }

  let text = raw
    .replace(/`([^`]+)`/g, (_, value) => hold(`<code>${escapeHtml(value)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      return hold(`<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`)
    })

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (match, prefix, url) => {
      const cleanUrl = url.replace(/[),.]+$/, '')
      const suffix = url.slice(cleanUrl.length)
      return `${prefix}<a href="${escapeAttribute(cleanUrl)}">${escapeHtml(cleanUrl)}</a>${escapeHtml(suffix)}`
    })

  for (const [token, html] of placeholders) {
    text = text.replaceAll(token, html)
  }

  return text
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function renderCss() {
  return `
:root {
  color-scheme: light;
  --ink: #000000;
  --muted: #000000;
  --rule: #000000;
  --paper: #ffffff;
  --screen: #ffffff;
  --accent: #000000;
  --soft: #ffffff;
  --math: #ffffff;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--screen);
  overflow-x: hidden;
}

body {
  margin: 0;
  color: var(--ink);
  background: var(--screen);
  font-family: "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "Times New Roman", Times, serif;
  font-size: 16px;
  overflow-x: hidden;
}

.reader-actions {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid rgba(23, 23, 23, 0.08);
  backdrop-filter: blur(12px);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.reader-actions a,
.reader-actions button {
  appearance: none;
  border: 1px solid rgba(23, 23, 23, 0.18);
  border-radius: 4px;
  background: #ffffff;
  color: #202326;
  cursor: pointer;
  font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  padding: 10px 12px;
  text-decoration: none;
}

.reader-actions button {
  background: #111111;
  border-color: #111111;
  color: #ffffff;
}

.paper-shell {
  padding: 0 18px 48px;
}

.paper {
  width: min(100%, 8.5in);
  margin: 0 auto;
  padding: 1.86in 1.34in 0.72in;
  background: var(--paper);
  border: 0;
  box-shadow: none;
}

.paper-title {
  margin: 0 auto 54px;
  text-align: center;
}

.paper-kicker,
.paper-meta p {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.35;
}

.paper-kicker {
  display: none;
  color: var(--accent);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  margin-bottom: 15px;
  text-transform: uppercase;
}

.paper-title h1 {
  max-width: 5.35in;
  margin: 0 auto 34px;
  font-size: 30px;
  font-weight: 400;
  line-height: 1.22;
}

.paper-meta {
  display: grid;
  gap: 13px;
  justify-items: center;
}

.paper-meta p:first-child {
  font-size: 19px;
}

.paper-meta p {
  font-size: 18px;
}

.paper-abstract {
  max-width: 4.85in;
  margin: 0 auto 44px;
}

.paper-abstract h2 {
  margin: 0 0 12px;
  text-align: center;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
}

.paper-abstract p {
  margin: 0;
  font-size: 15.6px;
  line-height: 1.25;
  text-align: justify;
}

.paper-abstract p + p {
  margin-top: 0;
  text-indent: 1.35em;
}

.paper-columns {
  max-width: 5.7in;
  margin: 0 auto;
}

.paper-columns h2,
.paper-columns h3 {
  break-after: avoid;
  font-weight: 700;
  line-height: 1.2;
}

.paper-columns h2 {
  margin: 0 0 22px;
  padding-top: 4px;
  font-size: 25px;
}

.paper-columns h2:not(:first-child) {
  margin-top: 38px;
}

.paper-columns h3 {
  margin: 22px 0 9px;
  color: #000000;
  font-size: 17px;
  font-style: italic;
}

.paper-columns p,
.paper-columns li {
  font-size: 16.2px;
  line-height: 1.22;
}

.paper-columns p {
  margin: 0;
  text-align: justify;
}

.paper-columns p + p {
  text-indent: 1.35em;
}

.paper-columns h2 + p,
.paper-columns h3 + p,
.paper-columns figure + p,
.paper-columns ol + p,
.paper-columns ul + p,
.paper-columns table + p {
  text-indent: 0;
}

.paper-columns ul,
.paper-columns ol {
  margin: 10px 0 12px 24px;
  padding: 0;
}

.paper-columns li {
  margin: 0 0 4px;
  padding-left: 2px;
}

.paper-columns strong {
  font-weight: 700;
}

a {
  color: var(--accent);
  text-decoration-thickness: 0.75px;
  text-underline-offset: 0.12em;
}

code {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-family: "Latin Modern Mono", "CMU Typewriter Text", "Courier New", monospace;
  font-size: 0.9em;
}

.math-block,
.note-block {
  break-inside: avoid;
  margin: 12px 0 14px;
  border: 0;
  background: transparent;
}

.math-block {
  overflow-x: auto;
  padding: 2px 0;
}

.math-block mjx-container[jax="SVG"][display="true"] {
  display: block;
  margin: 0;
  min-width: max-content;
  padding: 3px 0;
}

.math-block svg {
  display: block;
  margin: 0 auto;
}

.note-block {
  padding: 2px 0;
}

.note-block pre {
  margin: 0;
  color: #000000;
  font-family: "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "Times New Roman", Times, serif;
  font-size: 15.6px;
  font-style: normal;
  line-height: 1.25;
  text-align: center;
  white-space: pre-wrap;
}

.code-listing,
.table-wrap {
  break-inside: avoid;
  margin: 14px 0 16px;
}

.code-listing figcaption {
  margin: 0 0 5px;
  color: var(--muted);
  font-family: "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "Times New Roman", Times, serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-align: center;
  text-transform: none;
}

.code-listing pre {
  margin: 0;
  max-height: 4.9in;
  overflow: auto;
  padding: 8px 10px;
  border: 0.75px solid #000000;
  border-radius: 0;
  background: #ffffff;
  color: #000000;
  font-family: "Latin Modern Mono", "CMU Typewriter Text", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.24;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
  line-height: 1.2;
  border-top: 1px solid #000000;
  border-bottom: 1px solid #000000;
}

th,
td {
  padding: 5px 7px;
  border: 0;
  vertical-align: top;
}

th {
  border-bottom: 0.75px solid #000000;
  background: transparent;
  color: #000000;
  font-family: "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "Times New Roman", Times, serif;
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0;
  text-align: left;
  text-transform: none;
}

.price-chart {
  break-inside: avoid;
  margin: 16px 0 18px;
}

.price-chart figcaption {
  margin: 0 0 6px;
  color: #000000;
  font-family: "Latin Modern Roman", "CMU Serif", "Computer Modern Serif", "Times New Roman", Times, serif;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.price-chart-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.price-chart-bg {
  fill: #ffffff;
}

.price-chart-gridline line {
  stroke: #d7d7d7;
  stroke-width: 0.7;
}

.price-chart-gridline text,
.price-chart-x-label,
.price-chart-y-label,
.price-chart-band-label,
.price-chart-point-label {
  fill: #000000;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
}

.price-chart-gridline text {
  text-anchor: end;
}

.price-chart-x-label {
  text-anchor: middle;
}

.price-chart-y-label {
  text-anchor: middle;
  font-weight: 700;
}

.price-chart-axis {
  stroke: #000000;
  stroke-width: 1.1;
}

.price-chart-band rect {
  fill: #000000;
  opacity: 0.06;
}

.price-chart-band-refunded rect,
.price-chart-band-unmatched rect {
  opacity: 0.025;
}

.price-chart-band-label {
  font-size: 11px;
  font-weight: 700;
  text-anchor: end;
}

.price-chart-series path {
  fill: none;
  stroke: var(--series-stroke);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: var(--series-dash);
}

.price-chart-series circle {
  fill: #ffffff;
  stroke: var(--series-stroke);
  stroke-width: 1.8;
}

.price-chart-annotation line {
  fill: none;
  stroke: #000000;
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
}

.price-chart-annotation marker path,
.price-chart-svg marker path {
  fill: #000000;
}

.price-chart-annotation text {
  fill: #000000;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 700;
}

.price-chart-point-label {
  font-size: 11px;
  font-weight: 700;
  text-anchor: middle;
}

.price-chart-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 14px;
  margin-top: 2px;
  color: #000000;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.2;
}

.price-chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.price-chart-key {
  display: inline-block;
  width: 18px;
  border-top: 2px solid #000000;
}

.price-chart-caption {
  margin-top: 7px;
  color: #000000;
  font-size: 14px;
  line-height: 1.24;
  text-align: center;
  text-indent: 0;
}

.build-note {
  margin: 0 auto 24px;
  max-width: 8.5in;
  color: #777777;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 11px;
  text-align: center;
}

@media (max-width: 820px) {
  .reader-actions {
    position: static;
  }

  .paper-shell {
    padding: 0;
  }

  .paper {
    width: 100%;
    min-height: 100vh;
    padding: 104px 22px 44px;
    border: 0;
    box-shadow: none;
  }

  .paper-title h1 {
    font-size: 26px;
  }

  .paper-meta p,
  .paper-meta p:first-child {
    font-size: 16px;
  }

  .paper-abstract p,
  .paper-columns p {
    text-align: justify;
  }
}

@media print {
  @page {
    size: letter;
    margin: 0.62in 0.58in 0.62in;
  }

  html,
  body {
    background: #ffffff;
  }

  body {
    font-size: 11pt;
  }

  .reader-actions,
  .build-note {
    display: none;
  }

  .paper-shell {
    padding: 0;
  }

  .paper {
    width: auto;
    margin: 0;
    padding: 0;
    border: 0;
    box-shadow: none;
  }

  .paper-title {
    margin-bottom: 0.45in;
  }

  .paper-title h1 {
    font-size: 20pt;
  }

  .paper-abstract {
    margin-bottom: 0.38in;
  }

  .paper-columns p,
  .paper-columns li {
    font-size: 11pt;
    line-height: 1.18;
  }

  .math-block,
  .note-block {
    background: transparent;
  }

  .code-listing pre {
    max-height: none;
  }
}
`
}

await main()
