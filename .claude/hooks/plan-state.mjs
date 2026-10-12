#!/usr/bin/env node
// plan-state.mjs — hook SessionStart: al abrir, reanudar, compactar o hacer /clear,
// imprime el estado del plan activo para que la sesión retome sin releer el plan entero.
// Lo que este script imprime por stdout se agrega al contexto de la sesión.
// Plan activo = docs/plans/*.md cuya línea de estado dice "en curso", leído del árbol donde corre
// la sesión (un worktree tiene el avance de su rama). Los planes en curso de otros worktrees que no
// coinciden con los de este árbol se listan aparte, para que no se den por inexistentes.
// Sale siempre con código 0: un fallo aquí nunca debe bloquear la sesión.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_NOTE_LINES = 30;

const tryGit = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

function activePlans(root) {
  const dir = join(root, 'docs', 'plans');
  if (!existsSync(dir)) return [];
  const active = [];
  for (const f of readdirSync(dir).filter((name) => name.endsWith('.md') && !name.startsWith('_'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    const status = text.split('\n').find((l) => /^\*\*Estado:\*\*/i.test(l.trim()));
    if (status && /en curso/i.test(status)) active.push({ f, text, status: status.trim() });
  }
  return active;
}

function otherWorktrees(root) {
  const list = tryGit(root, 'worktree', 'list', '--porcelain');
  if (!list) return [];
  return list
    .split(/\r?\n\r?\n/)
    .map((block) => ({
      path: block.match(/^worktree (.+)$/m)?.[1],
      branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? '(desprendido)',
    }))
    .filter((w) => w.path && !samePath(w.path, root));
}

try {
  const root = tryGit(process.cwd(), 'rev-parse', '--show-toplevel') || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const active = activePlans(root);
  const out = [];

  if (active.length > 1) {
    out.push(`[plan-state] Hay ${active.length} planes en curso: ${active.map((a) => a.f).join(', ')}.`);
    out.push('Pregunta al usuario con cuál seguir antes de leer ninguno.');
  } else if (active.length === 1) {
    const { f, text, status } = active[0];
    const lines = text.split('\n');
    const next = lines.find((l) => /^###\s*\[ \]/.test(l));
    const start = lines.findIndex((l) => /^##\s*Notas para la próxima sesión/i.test(l));
    let notes = [];
    if (start >= 0) {
      for (const l of lines.slice(start + 1)) {
        if (/^##\s/.test(l)) break;
        notes.push(l);
      }
      notes = notes.filter((l) => l.trim() && !l.trim().startsWith('<!--')).slice(0, MAX_NOTE_LINES);
    }
    out.push(`[plan-state] Plan activo: docs/plans/${f}`);
    out.push(status);
    if (next) out.push(`Siguiente fase pendiente: ${next.replace(/^###\s*\[ \]\s*/, '')}`);
    if (notes.length) out.push('Notas para la próxima sesión:', ...notes);
    out.push(`Para continuar: /siguiente-fase ${f.replace(/\.md$/, '')}`);
  }

  const here = new Map(active.map((a) => [a.f, a.text]));
  const elsewhere = [];
  for (const { path, branch } of otherWorktrees(root)) {
    for (const plan of activePlans(path)) {
      if (here.get(plan.f) === plan.text) continue;
      const next = plan.text.split('\n').find((l) => /^###\s*\[ \]/.test(l));
      const phase = next ? `, siguiente: ${next.replace(/^###\s*\[ \]\s*/, '')}` : '';
      elsewhere.push(`- docs/plans/${plan.f} en la rama ${branch} (${path})${phase}`);
    }
  }
  if (elsewhere.length) {
    out.push('[plan-state] Planes en curso en otros worktrees, distintos de los de este árbol:', ...elsewhere);
  }

  if (out.length) process.stdout.write(out.join('\n') + '\n');
} catch {
  // Sin docs/plans o ilegible: no hay nada que reinyectar.
}
process.exit(0);
