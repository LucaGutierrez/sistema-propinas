import { describe, expect, it } from 'vitest';
import { feedbackInput } from '@/server/feedback/schemas';
import { isFeedbackReviewer, parseReviewers } from '@/server/feedback/service';
import { feedbackHref, parseFeedbackFilters, safeFeedbackPage } from './view';

describe('formulario de comentarios (validación)', () => {
  it('acepta tipo, título opcional y descripción; normaliza espacios y la pantalla', () => {
    expect(
      feedbackInput.parse({
        category: 'BUG',
        title: '   ',
        description: '  El total no coincide al cerrar.  ',
        page: '/reparto?x=1',
      }),
    ).toEqual({
      category: 'BUG',
      title: null,
      description: 'El total no coincide al cerrar.',
      page: '/reparto',
    });
  });

  it('rechaza lo incompleto o fuera de rango con mensajes claros', () => {
    const message = (raw: unknown) =>
      feedbackInput.safeParse(raw).error?.issues[0]?.message ?? null;
    expect(message({ description: 'Algo largo para describir' })).toBe(
      'Elegí el tipo: error, sugerencia o comentario.',
    );
    expect(message({ category: 'COMMENT', description: 'corto' })).toBe(
      'Contanos un poco más (al menos 10 caracteres).',
    );
    expect(message({ category: 'COMMENT', description: 'x'.repeat(4001) })).toBe(
      'La descripción puede tener hasta 4000 caracteres.',
    );
    expect(
      message({ category: 'SUGGESTION', title: 't'.repeat(121), description: 'Una idea buena' }),
    ).toBe('El título puede tener hasta 120 caracteres.');
  });

  it('la pantalla de origen solo puede ser una ruta interna', () => {
    expect(safeFeedbackPage('/historial/abc-123')).toBe('/historial/abc-123');
    expect(safeFeedbackPage('https://otro.com')).toBeNull();
    expect(safeFeedbackPage('//otro.com')).toBeNull();
    expect(safeFeedbackPage('/a b')).toBeNull();
    expect(safeFeedbackPage(null)).toBeNull();
  });
});

describe('revisores de comentarios', () => {
  it('solo los emails de la lista (sin distinguir mayúsculas); sin lista, nadie', () => {
    const reviewers = parseReviewers(' Equipo@GutiP.app, otro@example.com ,, nada ');
    expect([...reviewers]).toEqual(['equipo@gutip.app', 'otro@example.com']);
    const user = (email: string) => ({ id: '1', name: 'X', email });
    expect(isFeedbackReviewer(user('EQUIPO@gutip.app'), reviewers)).toBe(true);
    expect(isFeedbackReviewer(user('dueño@local.com'), reviewers)).toBe(false);
    expect(isFeedbackReviewer(null, reviewers)).toBe(false);
    expect(isFeedbackReviewer(user('equipo@gutip.app'), parseReviewers(undefined))).toBe(false);
  });
});

describe('filtros de la revisión', () => {
  it('lee tipo, estado y página; lo inválido se ignora', () => {
    expect(parseFeedbackFilters({ tipo: 'bug', estado: 'in_review', pagina: '2' })).toEqual({
      category: 'BUG',
      status: 'IN_REVIEW',
      page: 2,
    });
    expect(parseFeedbackFilters({ tipo: 'x', estado: 'y', pagina: '-1' })).toEqual({
      category: null,
      status: null,
      page: 1,
    });
    expect(feedbackHref({ category: 'SUGGESTION', status: 'NEW' }, 3)).toBe(
      '/feedback/revisar?tipo=SUGGESTION&estado=NEW&pagina=3',
    );
    expect(feedbackHref({})).toBe('/feedback/revisar');
  });
});
