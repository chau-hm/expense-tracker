#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphBuilder, detectLayers, generateHeuristicTour, saveGraph } from '/Users/chauhm/.understand-anything/repo/understand-anything-plugin/packages/core/dist/index.js';

const projectRoot = process.cwd();
const pluginRoot = '/Users/chauhm/.understand-anything/repo/understand-anything-plugin';
const skillDir = path.join(pluginRoot, 'skills/understand');
const intermediate = path.join(projectRoot, '.understand-anything/intermediate');
mkdirSync(intermediate, { recursive: true });

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

const scanInput = path.join(intermediate, 'scan-input.json');
const scanOutput = path.join(intermediate, 'scan-result.json');
const importMapInput = path.join(intermediate, 'import-map-input.json');
const importMapOutput = path.join(intermediate, 'import-map.json');

run('node', [path.join(skillDir, 'scan-project.mjs'), projectRoot, scanOutput]);
const scanResult = JSON.parse(readFileSync(scanOutput, 'utf8'));
const files = Array.isArray(scanResult.files) ? scanResult.files : [];
writeFileSync(scanInput, JSON.stringify({ projectRoot, files }, null, 2));
run('node', [path.join(skillDir, 'extract-import-map.mjs'), scanInput, importMapOutput]);
const importMap = JSON.parse(readFileSync(importMapOutput, 'utf8')).importMap || {};

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.dirname(fromFile);
  const withoutExt = specifier.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/,'');
  const candidates = [
    path.join(base, specifier),
    path.join(base, withoutExt),
    path.join(base, withoutExt + '.ts'),
    path.join(base, withoutExt + '.tsx'),
    path.join(base, withoutExt + '.js'),
    path.join(base, withoutExt + '.jsx'),
    path.join(base, withoutExt + '.mjs'),
    path.join(base, withoutExt + '.cjs'),
    path.join(base, specifier, 'index.ts'),
    path.join(base, specifier, 'index.tsx'),
    path.join(base, specifier, 'index.js'),
    path.join(base, specifier, 'index.jsx'),
    path.join(base, specifier, 'index.mjs'),
    path.join(base, specifier, 'index.cjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(projectRoot, candidate))) return candidate.replace(/\\/g, '/');
  }
  return null;
}

function collectImports(filePath) {
  const text = readFileSync(path.join(projectRoot, filePath), 'utf8');
  const specifiers = [];
  for (const match of text.matchAll(/(?:import|export)\s+(?:[^'";]+?from\s+)?['"]([^'"]+)['"]/g)) {
    const resolved = resolveLocalImport(filePath, match[1]);
    if (resolved) specifiers.push(resolved);
  }
  return [...new Set(specifiers)];
}

const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const projectName = pkg.name || path.basename(projectRoot);
const description = pkg.description || 'Expense tracker project';
const gitCommitHash = run('git', ['rev-parse', 'HEAD']).stdout.trim();

const builder = new GraphBuilder(projectName, gitCommitHash);

const categoryToNodeType = {
  code: 'file',
  config: 'config',
  docs: 'document',
  infra: 'service',
  data: 'schema',
  script: 'pipeline',
  markup: 'document',
};

for (const file of files) {
  const nodeType = categoryToNodeType[file.fileCategory] || 'file';
  const summary = `${file.language || 'file'} ${file.fileCategory || 'resource'} entry`;
  if (nodeType === 'file') {
    builder.addFile(file.path, { summary, tags: [file.fileCategory || 'code'], complexity: 'simple' });
  } else {
    builder.addNonCodeFile(file.path, {
      nodeType,
      summary,
      tags: [file.fileCategory || 'resource'],
      complexity: 'simple',
    });
  }
}

for (const file of files) {
  if (!['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js'].includes(file.language)) continue;
  const targets = collectImports(file.path);
  for (const target of targets) {
    if (existsSync(path.join(projectRoot, target))) {
      builder.addImportEdge(file.path, target);
    }
  }
}

const graph = builder.build();
graph.project.description = description;
graph.project.frameworks = ['TypeScript'];
graph.layers = detectLayers(graph);
graph.tour = generateHeuristicTour(graph);

saveGraph(projectRoot, graph);
console.log('Generated knowledge graph at', path.join(projectRoot, '.understand-anything/knowledge-graph.json'));
console.log('Nodes:', graph.nodes.length, 'Edges:', graph.edges.length, 'Layers:', graph.layers.length, 'Tour steps:', graph.tour.length);
