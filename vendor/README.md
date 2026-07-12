# vendor/

## `xlsx-0.20.3.tgz`

Fix `ARCH-13` (auditoría 12 de julio de 2026): `xlsx` no se publica en el
registro de npm desde hace varias versiones — SheetJS lo distribuye solo
desde su propio CDN (`cdn.sheetjs.com`). `package.json` apuntaba
directamente a esa URL, así que cualquier `npm install` en una red
restringida (CI con firewall estricto, sandbox sin ese dominio en su
allowlist, etc.) fallaba con `403 Forbidden` y bloqueaba toda la suite de
tests — mismo síntoma ya documentado en `D-6`.

Este archivo es el tarball oficial descargado de
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, la misma versión
exacta que ya usaba producción (no se cambió de versión, solo de origen).
`package.json` ahora apunta aquí (`file:./vendor/xlsx-0.20.3.tgz`) en vez
de a la URL del CDN, así que `npm install` funciona sin salir a internet
para esta dependencia.

**Integridad** (verificar si hay dudas de que el archivo no se corrompió):
```
sha256sum vendor/xlsx-0.20.3.tgz
# 8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8
```

**Cómo actualizar a una versión más nueva de `xlsx`:**
1. Descargar el tarball nuevo desde `https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`
   (ver versión disponible en https://sheetjs.com/).
2. Reemplazar este archivo (renombrar con la versión nueva) y actualizar
   la ruta en `package.json` (`dependencies.xlsx`).
3. Actualizar el hash de este README.
4. Correr `npm install && npm run build && npm test` antes de commitear,
   revisando el changelog de SheetJS por cambios breaking en el parseo de
   Excel (afecta directamente a `excelParser.js`).
