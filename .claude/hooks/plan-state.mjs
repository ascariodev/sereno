#!/usr/bin/env node
// plan-state.mjs — hook SessionStart: al abrir, reanudar, compactar o hacer /clear,
// imprime el estado del plan activo para que la sesión retome sin releer el plan entero.
// Lo que este script imprime por stdout se agrega al contexto de la sesión.
// Plan activo = docs/plans/*.md cuya línea de estado dice "en curso".
// Sale siempre con código 0: un fallo aquí nunca debe bloquear la sesión.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_NOTE_LINES = 30;

try {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = join(root, 'docs', 'plans');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));

  const active = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const status = text.split('\n').find((l) => /^\*\*Estado:\*\*/i.test(l.trim()));
    if (status && /en curso/i.test(status)) active.push({ f, text, status: status.trim() });
  }

  if (active.length === 0) process.exit(0);

  const out = [];
  if (active.length > 1) {
    out.push(`[plan-state] Hay ${active.length} planes en curso: ${active.map((a) => a.f).join(', ')}.`);
    out.push('Pregunta al usuario con cuál seguir antes de leer ninguno.');
  } else {
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
  process.stdout.write(out.join('\n') + '\n');
} catch {
  // Sin docs/plans o ilegible: no hay nada que reinyectar.
}
process.exit(0);
