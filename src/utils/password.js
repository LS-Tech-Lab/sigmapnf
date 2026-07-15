/**
 * password.js — validación centralizada de contraseñas (SEC-5).
 *
 * Exporta validarPassword(), usada en:
 *   - ModalCambiarPassword.jsx
 *   - ModalUsuario.jsx
 *   - api/admin-users.js (require/import)
 *
 * Reglas de complejidad mínima:
 *   - Al menos 10 caracteres
 *   - Al menos una letra mayúscula
 *   - Al menos un dígito
 *
 * @param {string} pwd
 * @returns {string|null}  Mensaje de error, o null si la contraseña es válida.
 */
export function validarPassword(pwd) {
  if (!pwd || pwd.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (!/[A-Z]/.test(pwd))      return "La contraseña debe incluir al menos una letra mayúscula.";
  if (!/[0-9]/.test(pwd))      return "La contraseña debe incluir al menos un número.";
  return null; // válida
}
