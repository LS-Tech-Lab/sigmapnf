// =====================================================================
// cruceMedianocheVE.test.js — Pendiente F: suite de cruce de medianoche
// (20:00–00:00 hora de Venezuela)
//
// fechaHoyVE() fue corregida en junio (commits fecha-hoy-timezone) para
// dejar de usar Date().toISOString().slice(0,10) (UTC) y usar
// America/Caracas explícito — el bug original: entre las 8:00pm y las
// 11:59pm hora VE, UTC ya rodó al día siguiente, así que "hoy" se
// adelantaba un día. El fix nunca tuvo una suite dedicada que fije el
// comportamiento correcto en ese tramo exacto (20:00–00:00 VE); esta
// suite cierra ese hueco.
//
// También cubre el comportamiento actual de partesHoraNormalizadas /
// parseRango / countBlocks cuando un rango de hora cruza la medianoche
// real (ej. "8:00PM - 12:00AM"), ya que ningún turno activo en
// TURNOS_CONFIG cruza medianoche hoy (NOCTURNO llega hasta 9:30pm y
// está deshabilitado) pero la suite deja documentado y testeado qué
// pasa si en el futuro se configura uno que sí cruce.
//
// Venezuela no observa horario de verano (UTC-4 fijo todo el año), así
// que los offsets UTC usados abajo son válidos en cualquier época del
// año.
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fechaHoyVE, diaSemanaVE, timeToMin, minToTime, countBlocks } from "./time";
import { partesHoraNormalizadas } from "./time";
import { parseRango, solapan, tienenConflicto } from "./conflictos";

describe("fechaHoyVE — tramo 20:00–00:00 VE (regresión del fix fecha-hoy-timezone)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 2026-08-07 es viernes. VE = UTC-4, así que:
  //   viernes 20:00:00 VE == sábado 00:00:00 UTC
  //   viernes 23:59:59 VE == sábado 03:59:59 UTC
  //   sábado  00:00:00 VE == sábado 04:00:00 UTC
  it("a las 8:00pm VE (justo al cruzar a UTC del día siguiente) sigue siendo el día VE anterior", () => {
    vi.setSystemTime(new Date("2026-08-08T00:00:00Z"));
    expect(fechaHoyVE()).toBe("2026-08-07");
  });

  it("a las 11:59:59pm VE (un segundo antes de medianoche VE) sigue siendo el día VE anterior", () => {
    vi.setSystemTime(new Date("2026-08-08T03:59:59Z"));
    expect(fechaHoyVE()).toBe("2026-08-07");
  });

  it("justo en medianoche VE (00:00:00) ya avanzó al día siguiente", () => {
    vi.setSystemTime(new Date("2026-08-08T04:00:00Z"));
    expect(fechaHoyVE()).toBe("2026-08-08");
  });

  it("a las 00:00:01 VE (un segundo después de medianoche) confirma el día nuevo, sin rebote", () => {
    vi.setSystemTime(new Date("2026-08-08T04:00:01Z"));
    expect(fechaHoyVE()).toBe("2026-08-08");
  });

  it("recorrido continuo 19:00→01:00 VE: la fecha solo cambia una vez, exactamente en medianoche", () => {
    // Instantes UTC pre-calculados (VE = UTC-4) para 19:00, 20:00, 21:30,
    // 22:00, 23:00 y 23:59 hora VE del viernes 2026-08-07 — todos caen
    // dentro del sábado 2026-08-08 en UTC, pero deben seguir reportando
    // el viernes en fechaHoyVE().
    const instantesAntesDeMedianocheVE = [
      "2026-08-07T23:00:00Z", // 19:00 VE
      "2026-08-08T00:00:00Z", // 20:00 VE
      "2026-08-08T01:30:00Z", // 21:30 VE
      "2026-08-08T02:00:00Z", // 22:00 VE
      "2026-08-08T03:00:00Z", // 23:00 VE
      "2026-08-08T03:59:00Z", // 23:59 VE
    ];
    instantesAntesDeMedianocheVE.forEach((iso) => {
      vi.setSystemTime(new Date(iso));
      expect(fechaHoyVE()).toBe("2026-08-07");
    });
    // cruce exacto de medianoche VE
    vi.setSystemTime(new Date("2026-08-08T04:00:00Z"));
    expect(fechaHoyVE()).toBe("2026-08-08");
    vi.setSystemTime(new Date("2026-08-08T05:00:00Z")); // 01:00 VE
    expect(fechaHoyVE()).toBe("2026-08-08");
  });

  it("confirma el bug original: comparar contra el equivalente UTC ingenuo muestra el desfase que el fix corrige", () => {
    // A las 20:00 VE, el cálculo ingenuo (toISOString().slice(0,10), es
    // decir la fecha UTC) YA muestra el día siguiente — es precisamente
    // el bug que fechaHoyVE() existe para evitar.
    const instanteVE20h = new Date("2026-08-08T00:00:00Z");
    vi.setSystemTime(instanteVE20h);
    const fechaIngenuaUTC = instanteVE20h.toISOString().slice(0, 10);
    expect(fechaIngenuaUTC).toBe("2026-08-08"); // el bug: UTC ya rodó
    expect(fechaHoyVE()).toBe("2026-08-07"); // el fix: VE no ha rodado
    expect(fechaHoyVE()).not.toBe(fechaIngenuaUTC);
  });
});

describe("diaSemanaVE — consistencia con fechaHoyVE al cruzar medianoche VE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a las 11:59pm VE, fechaHoyVE()+diaSemanaVE() todavía reportan viernes", () => {
    vi.setSystemTime(new Date("2026-08-08T03:59:59Z"));
    const hoy = fechaHoyVE();
    expect(diaSemanaVE(hoy)).toBe("VIERNES");
  });

  it("un segundo después (medianoche VE), la pareja fechaHoyVE()+diaSemanaVE() avanza a sábado", () => {
    vi.setSystemTime(new Date("2026-08-08T04:00:00Z"));
    const hoy = fechaHoyVE();
    expect(diaSemanaVE(hoy)).toBe("SÁBADO");
  });
});

describe("timeToMin / minToTime — límites de medianoche (12:00AM = 0 min)", () => {
  it("timeToMin('12:00AM') es 0, no 720 (error común de confundir 12AM con mediodía)", () => {
    expect(timeToMin("12:00AM")).toBe(0);
  });

  it("timeToMin('11:59PM') es 1439, el último minuto antes de medianoche", () => {
    expect(timeToMin("11:59PM")).toBe(1439);
  });

  it("minToTime(0) vuelve a '12:00AM' (round-trip con timeToMin)", () => {
    expect(minToTime(0)).toBe("12:00AM");
  });

  it("minToTime(1439) vuelve a '11:59PM'", () => {
    expect(minToTime(1439)).toBe("11:59PM");
  });

  it("minToTime tolera minutos >= 1440 envolviendo al día siguiente (módulo 1440)", () => {
    expect(minToTime(1440)).toBe("12:00AM"); // 24:00 envuelve a 0
    expect(minToTime(1440 + 30)).toBe("12:30AM");
  });

  it("minToTime tolera negativos envolviendo hacia atrás desde medianoche", () => {
    expect(minToTime(-30)).toBe("11:30PM");
  });
});

describe("partesHoraNormalizadas / parseRango — rango que cruza medianoche real (20:00–00:00)", () => {
  it("un rango con ambas horas explícitas ('8:00PM - 12:00AM') no rompe el parseo de partes", () => {
    expect(partesHoraNormalizadas("8:00PM - 12:00AM")).toEqual(["8:00PM", "12:00AM"]);
  });

  it("timeToMin del fin ('12:00AM') da 0 — comportamiento ACTUAL: como 0 no es > que el inicio (1200), " +
    "parseRango cae al bloque por defecto de 45 min en vez de representar el tramo real hasta medianoche. " +
    "Se deja fijado explícitamente porque hoy ningún turno activo cruza medianoche (NOCTURNO llega solo " +
    "hasta 9:30pm y está deshabilitado) — si se habilita un turno que sí cruce medianoche, este test debe " +
    "actualizarse junto con el fix correspondiente en parseRango/conflictos.js.", () => {
    const rango = parseRango("8:00PM - 12:00AM");
    expect(rango).toEqual({ inicio: 1200, fin: 1245 }); // 20:00 + 45min por defecto, NO hasta medianoche real
  });

  it("countBlocks tiene la misma limitación: un rango 8:00PM-12:00AM cuenta como 1 bloque, no como el tramo real de 4h", () => {
    expect(countBlocks("8:00PM - 12:00AM")).toBe(1);
  });

  it("un rango que cruza medianoche NO se confunde con uno inválido: sigue devolviendo un rango parseable, no null", () => {
    expect(parseRango("8:00PM - 12:00AM")).not.toBeNull();
  });

  it("dos clases 8:00PM-11:00PM y 11:15PM-12:00AM (ambas antes de medianoche) sí conservan su solapamiento real", () => {
    // Caso de control: mientras el rango completo no cruce medianoche,
    // la detección de conflictos funciona con normalidad.
    const a = { hora: "8:00PM - 11:00PM" };
    const b = { hora: "10:30PM - 11:30PM" };
    expect(tienenConflicto(a, b)).toBe(true);
  });

  it("HALLAZGO: una clase que EMPIEZA exactamente en '12:00AM' se descarta como null, no como inicio=0 — " +
    "parseRango usa 'inicio === 0' para detectar hora no reconocible (ver time.js: timeToMin devuelve 0 tanto " +
    "para '12:00AM' real como para un string irreconocible), así que no puede distinguir ambos casos. Como hoy " +
    "ningún turno real empieza a medianoche, no es explotable en producción, pero queda documentado para que " +
    "un futuro turno NOCTURNO extendido (o una hora ingresada manualmente) no falle en silencio.", () => {
    const empiezaMedianoche = parseRango("12:00AM - 12:45AM");
    expect(empiezaMedianoche).toBeNull(); // comportamiento actual, no el ideal
  });
});

describe("solapan — sanity check en los extremos del eje de minutos (0 y 1439)", () => {
  it("dos rangos pegados exactamente en medianoche (0) no se consideran solapados", () => {
    expect(solapan({ inicio: 1380, fin: 1439 }, { inicio: 0, fin: 60 })).toBe(false);
  });

  it("un rango que toca el último minuto del día (1439) y otro que arranca ahí mismo sí se consideran solapados", () => {
    expect(solapan({ inicio: 1400, fin: 1439 }, { inicio: 1438, fin: 1470 })).toBe(true);
  });
});
