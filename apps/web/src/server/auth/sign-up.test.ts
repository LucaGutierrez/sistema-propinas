import { describe, expect, it } from 'vitest';
import { createRestaurantInput } from '../restaurants/schemas';
import { MAX_SIGN_UP_NAME, signUpBodyError } from './sign-up';

const OK = { name: 'Ana', email: 'ana@example.com', password: 'una-clave-larga' };

describe('reglas del registro', () => {
  it('acepta nombre, email y contraseña (y rememberMe/callbackURL del cliente)', () => {
    expect(signUpBodyError(OK)).toBeNull();
    expect(signUpBodyError({ ...OK, rememberMe: true, callbackURL: '/' })).toBeNull();
  });

  it('exige un nombre de hasta 80 caracteres', () => {
    expect(signUpBodyError({ ...OK, name: '   ' })).toBe('Poné tu nombre.');
    expect(signUpBodyError({ ...OK, name: undefined })).toBe('Poné tu nombre.');
    expect(signUpBodyError({ ...OK, name: 'x'.repeat(MAX_SIGN_UP_NAME + 1) })).toMatch(/hasta 80/);
  });

  it.each([
    { role: 'OWNER' },
    { restaurantId: 'x' },
    { image: 'https://x' },
    { emailVerified: true },
  ])('rechaza campos que el registro no acepta: %j', (extra) => {
    expect(signUpBodyError({ ...OK, ...extra })).toBe('Datos inválidos.');
  });

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(signUpBodyError(null)).toBe('Datos inválidos.');
    expect(signUpBodyError('x')).toBe('Datos inválidos.');
  });
});

describe('nombre del restaurante', () => {
  it('sin espacios de más, obligatorio y de hasta 120 caracteres', () => {
    expect(createRestaurantInput.parse({ name: '  Restaurante Test ' }).name).toBe(
      'Restaurante Test',
    );
    expect(createRestaurantInput.safeParse({ name: '  ' }).success).toBe(false);
    expect(createRestaurantInput.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
  });

  it('solo acepta el nombre: el rol o el usuario del navegador se descartan', () => {
    expect(createRestaurantInput.parse({ name: 'Local', role: 'VIEWER', userId: 'otro' })).toEqual({
      name: 'Local',
    });
  });
});
