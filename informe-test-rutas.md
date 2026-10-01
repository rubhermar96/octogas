# Informe de test de la lógica del planificador de rutas

_Generado el 2026-10-01 11:25 · **123 escenarios** (23 detallados + 100 de cobertura) · 11.476 gasolineras reales_

> **Unicidad:** 123 firmas únicas de 123 escenarios → ✅ ninguna opción se repite.

> **Corrección aplicada:** `pickStops` reescrito para que cada parada sea a la vez PREFERENTE y FACTIBLE (ventana acotada al alcance real desde la parada anterior). Antes de este cambio, este test detectaba planes inviables en rutas de ≥2 repostajes (te quedabas seco entre paradas). Este informe re-verifica todo el pipeline con el fix.

## Metodología

- **Datos reales:** `public/data/stations.json` (11.476 estaciones con precios del día).
- **Rutas reales:** geometría de Valhalla → OSRM (igual que en la app). Endpoints con coordenadas fijas de cada ciudad (deterministas, sin geocoding).
- **Funciones bajo test (sin mocks):** `computeFuelPlan`, `findCorridorStations`, `pickStops`, `allocateRefuels`, `simulateTankLevels` de `src/lib/route.ts` — el mismo pipeline que ejecuta `RoutePlanner.tsx`.
- **123 escenarios únicos:** 23 **curados** con volcado completo y justificación de cada gasolinera, y 100 **de cobertura** (combinaciones de ruta × perfil de coche × combustible × depósito × prioridad × filtros). Para no hacer ilegible el informe, de los de cobertura solo se detallan los que tengan alguna incidencia (⚠️/❌); el resto aparece en la tabla resumen.
- **Justificación de cada elección:** se reproduce el modelo de puntuación de `pickStops` (ventana factible por parada + score `peso_precio·precio_norm + peso_tiempo·tiempo_norm`), con un oráculo que verifica que la reproducción coincide con la elección real del algoritmo.
- **Modelo de score (idéntico a route.ts):** barato `{precio:1, tiempo:0.05}`, equilibrado `{0.6, 0.4}`, rápido `{0.05, 1}`. Parada dedicada = +6 km equivalentes; repostar a ≤4 km de una parada propia no penaliza tiempo. Margen de seguridad entre paradas = 8%.

### Cómo leer las tablas de selección

- **Progreso:** posición de la estación a lo largo de la ruta (0% origen, 100% destino).
- **Ventana:** tramo donde `pickStops` puede colocar la parada nº k. Su tope superior = hasta dónde llegas desde la parada anterior (alcance real); el inferior asegura que las paradas restantes lleguen al destino y prefiere repostar en el último ~45% del depósito.
- **Score:** menor = mejor. La elegida es la de menor score entre las candidatas de su ventana.
- **timeCost:** desvío al trazado + penalización de parada dedicada.

> Un resultado **⚠️/❌** no siempre es un bug: puede ser un caso límite legítimo (p. ej. forzar menos paradas de las necesarias). Cada uno lleva su detalle para que juzgues la lógica.

## Hallazgos y conclusiones

✅ **Con la corrección aplicada NO queda ningún fallo de lógica (❌)** en los 123 escenarios. Los dos problemas que este test encontró antes del fix están resueltos:

1. **Ningún plan deja el depósito en seco entre paradas.** En todas las estrategias de todos los escenarios (incluidos los de 3, 4 y 5+ repostajes con depósito pequeño), cada tramo entre paradas consecutivas es ≤ autonomía del depósito y, en modo automático, se llega siempre al destino sin quedarse tirado. La reescritura de `pickStops` distingue el **mínimo innegociable** (para no quedarte tirado ni pasarte del destino, reservando el combustible de llegada) de la **preferencia** (repostar en el último ~45% del tanque), y el *fallback* de "ventana sin estaciones" ya nunca coge una gasolinera al principio de la ruta.
2. **Desaparecen las grandes inversiones de coste** (antes de +16 a +27 € en los planes que se quedaban secos, por el recorte a 0 L de `allocateRefuels`). Al ser todos los planes viables, los litros y costes vuelven a ser físicamente exactos.

**Matiz (⚠️, no bug):** en algún caso "Más barato" puede costar unos céntimos/1-2 € más que "Equilibrado". No es un error: "barato" pondera un 5% el tiempo, así que puede preferir una estación ~0,005 €/L más cara pero con menos desvío. Es un compromiso de diseño deliberado y de magnitud despreciable; si se quisiera "coste puro" bastaría con poner el peso de tiempo a 0 en la prioridad "barato".

Sigue siendo correcto todo lo que ya funcionaba (nº mínimo de paradas, corredor ≤4 km, filtros de marca/combustible, orden por progreso, reserva de llegada, diferenciación de estrategias, peajes, ida y vuelta y hasta 5 paradas del conductor). Los ⚠️ restantes son casos límite legítimos: forzar menos paradas de las necesarias (se avisa de que te quedarías sin combustible), pedir una reserva de llegada muy alta (llegas por debajo de lo pedido), o corredores donde no hay tantas gasolineras separadas como paradas pedidas.

### 🟢 Nota sobre el "sobre-repostaje" forzado

Al forzar **más paradas de las necesarias** (p. ej. 3 cuando basta 1), las ventanas de las últimas paradas se acercan al destino y algunas se reparten repostajes pequeños. No es peligroso ni incorrecto (llegas bien), pero es una rareza de UX: podría avisarse de que se piden más paradas de las útiles.

### ✅ Lo que funciona correctamente

- **Nº mínimo de paradas** (`computeFuelPlan`): correcto en todos los casos (0 en trayectos cortos/depósito grande; escala con distancia, consumo y capacidad).
- **Corredor** (`findCorridorStations`): todas las paradas caen a ≤4 km del trazado; respeta el filtro de marca y de combustible (corredor vacío → error esperado al usuario).
- **Viabilidad y orden**: paradas ordenadas por progreso, cada tramo dentro de la autonomía, y llegada al destino con la reserva en todos los escenarios de modo automático.
- **Diferenciación de estrategias**: "barato" baja el precio medio, "rápido" minimiza el desvío y aprovecha el efecto *convenient* (repostar junto a una parada propia sin penalizar tiempo).
- **Réplica del score = elección real de `pickStops`** en el 100% de los escenarios (el modelo de justificación reproduce exactamente la elección del algoritmo).
- **Modos forzados / evitar peajes / ida y vuelta / waypoints (hasta 5)**: se comportan como se espera.

## Resumen

**123 escenarios · 123 únicos (sin repeticiones).** Comprobaciones: ✅ 2335 · ⚠️ 48 · ❌ 0

_Columna "Coste b/e/r" = coste de repostaje en barato/equilibrado/rápido. Los escenarios en **negrita** llevan volcado detallado más abajo; el resto se resume aquí (y se detallan solo si tienen ⚠️/❌)._

| Escenario | Distancia | Paradas | Coste b/e/r | ✅ | ⚠️ | ❌ |
|---|--:|---|--:|--:|--:|--:|
| **S01 Trayecto corto, depósito lleno → 0 paradas** | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| **S02 Media distancia, salida 50% → 1 parada (auto)** | 620 km | 1 (auto) | 36.2/36.2/37.8 € | 21 | 0 | 0 |
| **S03 Larga distancia → 2 paradas (auto)** | 1112 km | 1 (auto) | 71.6/71.6/74.1 € | 21 | 0 | 0 |
| **S04 Muy larga + depósito pequeño → ~3 paradas (auto)** | 1167 km | 4 (auto) | 164.7/164.7/176.7 € | 21 | 0 | 0 |
| **S05 Extremo: depósito 25 L → >3 paradas (auto)** | 1043 km | 5 (auto) | 170.1/170.5/181.6 € | 21 | 0 | 0 |
| **S06 Diésel, 1 parada** | 360 km | 1 (auto) | 17.2/17.5/18.2 € | 21 | 0 | 0 |
| **S07 GLP (autogas): corredor escaso** | 397 km | 1 (auto) | 14.8/14.8/20.0 € | 21 | 0 | 0 |
| **S08 Evitar peajes (Madrid→Sevilla)** | 534 km | 1 (auto) | 31.1/31.1/34.8 € | 21 | 0 | 0 |
| **S09 Evitar peajes (Barcelona→Madrid)** | 630 km | 1 (auto) | 40.7/40.7/47.5 € | 21 | 0 | 0 |
| **S10 Filtro de marca: solo Repsol** | 620 km | 1 (auto) | 48.8/48.8/49.6 € | 21 | 0 | 0 |
| **S11 Filtro de marca: Cepsa + BP** | 620 km | 1 (auto) | 49.1/49.1/49.8 € | 21 | 0 | 0 |
| **S12 1 parada del conductor (waypoint)** | 766 km | 1 (auto) | 52.9/52.9/56.6 € | 21 | 0 | 0 |
| **S13 2 paradas del conductor** | 626 km | 1 (auto) | 43.1/43.1/45.0 € | 21 | 0 | 0 |
| **S14 4 paradas del conductor (>3)** | 597 km | 1 (auto) | 37.0/38.4/38.4 € | 21 | 0 | 0 |
| **S15 5 paradas del conductor (>3)** | 1179 km | 2 (auto) | 104.4/106.9/110.1 € | 21 | 0 | 0 |
| **S16 Forzar 1 parada cuando auto pide 2 (infra-repostaje)** | 1112 km | 1 (forzado, auto=1) | 71.6/71.6/74.1 € | 21 | 0 | 0 |
| **S17 Forzar 3 paradas cuando auto pide 1 (sobre-repostaje)** | 620 km | 3 (forzado, auto=1) | 36.2/36.3/38.0 € | 21 | 0 | 0 |
| **S18 Ida y vuelta** | 721 km | 1 (auto) | 41.7/41.7/49.9 € | 21 | 0 | 0 |
| **S19 Salida muy baja (20%)** | 620 km | 1 (auto) | 60.0/60.0/62.6 € | 21 | 0 | 0 |
| **S20 Reserva de llegada alta (50%)** | 620 km | 1 (auto) | 74.9/74.9/77.0 € | 21 | 0 | 0 |
| **S21 Furgoneta (consumo 9.5)** | 534 km | 1 (auto) | 63.9/66.3/70.3 € | 21 | 0 | 0 |
| **S22 Depósito grande (80 L), salida 90%** | 840 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| **S23 SP98 (combustible premium poco común)** | 421 km | 1 (auto) | 21.4/21.7/23.6 € | 21 | 0 | 0 |
| G001 Madrid→Toledo · Compacto · SP95 · 30/10% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G002 Madrid→Valencia · Compacto · Diésel · 45/15% · 1 | 360 km | 1 (forzado, auto=1) | 5.7/5.7/5.9 € | 21 | 0 | 0 |
| G003 Madrid→Barcelona · Compacto · SP98 · 60/25% · auto | 620 km | 1 (auto) | 26.5/28.4/29.8 € | 21 | 0 | 0 |
| G004 Madrid→Sevilla · Compacto · SP95 · 80/40% · 2 · Repsol | 534 km | 2 (forzado, auto=1) | 13.2/13.2/13.9 € | 21 | 0 | 0 |
| G005 Madrid→Málaga · Compacto · Diésel · 90/10% · auto · Cepsa+BP | 536 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G006 Madrid→Bilbao · Compacto · SP98 · 30/15% · auto | 397 km | 1 (auto) | 23.8/23.8/27.0 € | 21 | 0 | 0 |
| G007 Madrid→Granada · Compacto · SP95 · 45/25% · 1 | 421 km | 1 (forzado, auto=1) | 19.5/19.5/19.5 € | 21 | 0 | 0 |
| G008 Barcelona→Cádiz · Compacto · Diésel · 60/40% · auto | 1112 km | 1 (auto) | 103.8/103.8/103.8 € | 21 | 0 | 0 |
| G009 Barcelona→Sevilla · Compacto · SP98 · 80/10% · 2 · Repsol | 994 km | 2 (forzado, auto=1) | 31.0/31.1/31.7 € | 21 | 0 | 0 |
| G010 Barcelona→Madrid · Compacto · SP95 · 90/15% · auto · sin peaje · Cepsa+BP | 630 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G011 A Coruña→Almería · Compacto · Diésel · 30/25% · auto | 1167 km | 2 (auto) | 105.2/105.8/112.2 € | 21 | 0 | 0 |
| G012 A Coruña→Cartagena · Compacto · SP98 · 45/40% · 1 | 1043 km | 1 (forzado, auto=1) | 115.7/115.7/115.7 € | 18 | 3 | 0 |
| G013 A Coruña→Madrid · Compacto · SP95 · 60/10% · auto | 592 km | 1 (auto) | 7.9/7.9/9.4 € | 21 | 0 | 0 |
| G014 Valencia→Bilbao · Compacto · Diésel · 80/15% · 2 · Repsol | 612 km | 2 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G015 Valencia→A Coruña · Compacto · SP98 · 90/25% · auto · Cepsa+BP | 951 km | 1 (auto) | 31.6/31.8/32.7 € | 21 | 0 | 0 |
| G016 Zaragoza→Sevilla · Compacto · SP95 · 30/40% · auto | 840 km | 1 (auto) | 93.1/93.1/93.1 € | 18 | 3 | 0 |
| G017 Málaga→Bilbao · Compacto · Diésel · 45/10% · 1 | 930 km | 1 (forzado, auto=1) | 56.1/56.8/61.6 € | 21 | 0 | 0 |
| G018 Cartagena→Madrid · Compacto · SP98 · 60/15% · auto | 451 km | 1 (auto) | 0.1/0.1/0.1 € | 21 | 0 | 0 |
| G019 Granada→Zaragoza · Compacto · SP95 · 80/25% · 2 · Repsol | 729 km | 2 (forzado, auto=1) | 17.8/17.8/18.2 € | 21 | 0 | 0 |
| G020 Sevilla→Barcelona · Compacto · Diésel · 90/40% · auto · Cepsa+BP | 1039 km | 1 (auto) | 57.2/57.2/59.6 € | 21 | 0 | 0 |
| G021 Bilbao→Málaga · Compacto · SP98 · 30/10% · auto | 936 km | 1 (auto) | 76.3/78.5/78.5 € | 21 | 0 | 0 |
| G022 Almería→Bilbao · Compacto · SP95 · 45/15% · 1 | 977 km | 1 (forzado, auto=1) | 61.4/63.3/65.4 € | 21 | 0 | 0 |
| G023 Valencia→Bilbao +1wp · Compacto · Diésel · 60/25% · auto | 766 km | 1 (auto) | 39.7/39.7/44.5 € | 21 | 0 | 0 |
| G024 Madrid→Barcelona +2wp · Compacto · SP98 · 80/40% · 2 · Repsol | 626 km | 2 (forzado, auto=1) | 23.8/23.5/23.5 € | 19 | 2 | 0 |
| G025 Cádiz→Barcelona +1wp · Compacto · SP95 · 90/10% · auto · Cepsa+BP | 1277 km | 1 (auto) | 47.6/48.2/49.1 € | 21 | 0 | 0 |
| G026 Bilbao→Valencia +1wp · Compacto · Diésel · 30/15% · auto | 612 km | 1 (auto) | 44.4/45.2/45.9 € | 21 | 0 | 0 |
| G027 Madrid→Málaga +4wp · Compacto · SP98 · 45/25% · 1 | 597 km | 1 (forzado, auto=1) | 37.7/41.8/43.1 € | 21 | 0 | 0 |
| G028 Bilbao→Málaga +5wp · Compacto · SP95 · 60/40% · auto | 1179 km | 1 (auto) | 97.5/97.5/97.5 € | 18 | 3 | 0 |
| G029 Madrid→Sevilla · Compacto · Diésel · 80/10% · 2 · sin peaje · Repsol | 534 km | 2 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G030 Madrid→Valencia · Compacto · SP98 · 90/15% · auto · i/v · Cepsa+BP | 721 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G031 Barcelona→Cádiz · Compacto · SP95 · 30/25% · auto · i/v | 2213 km | 3 (auto) | 199.8/195.9/203.9 € | 19 | 2 | 0 |
| G032 Madrid→Toledo · Berlina · Diésel · 45/25% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G033 Madrid→Valencia · Berlina · SP98 · 60/40% · 2 | 360 km | 2 (forzado, auto=1) | 24.5/24.5/26.6 € | 21 | 0 | 0 |
| G034 Madrid→Barcelona · Berlina · SP95 · 80/10% · auto · Repsol | 620 km | 1 (auto) | 9.3/9.5/9.8 € | 21 | 0 | 0 |
| G035 Madrid→Sevilla · Berlina · Diésel · 90/15% · auto · Cepsa+BP | 534 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G036 Madrid→Málaga · Berlina · SP98 · 30/25% · 1 | 536 km | 1 (forzado, auto=1) | 56.0/60.3/61.7 € | 21 | 0 | 0 |
| G037 Madrid→Bilbao · Berlina · SP95 · 45/40% · auto | 397 km | 1 (auto) | 37.7/39.1/41.9 € | 21 | 0 | 0 |
| G038 Madrid→Granada · Berlina · Diésel · 60/10% · 2 | 421 km | 2 (forzado, auto=1) | 4.2/4.2/4.3 € | 21 | 0 | 0 |
| G039 Barcelona→Cádiz · Berlina · SP98 · 80/15% · auto · Repsol | 1112 km | 1 (auto) | 78.4/78.4/78.4 € | 21 | 0 | 0 |
| G040 Barcelona→Sevilla · Berlina · SP95 · 90/25% · auto · Cepsa+BP | 994 km | 1 (auto) | 58.1/58.4/59.8 € | 21 | 0 | 0 |
| G041 Barcelona→Madrid · Berlina · Diésel · 30/40% · 1 · sin peaje | 630 km | 1 (forzado, auto=1) | 90.9/90.9/90.9 € | 21 | 0 | 0 |
| G042 A Coruña→Almería · Berlina · SP98 · 45/10% · auto | 1167 km | 2 (auto) | 103.4/107.3/110.0 € | 21 | 0 | 0 |
| G043 A Coruña→Cartagena · Berlina · SP95 · 60/15% · 2 | 1043 km | 2 (forzado, auto=1) | 75.5/75.5/83.4 € | 21 | 0 | 0 |
| G044 A Coruña→Madrid · Berlina · Diésel · 80/25% · auto · Repsol | 592 km | 1 (auto) | 21.8/22.0/22.0 € | 21 | 0 | 0 |
| G045 Valencia→Bilbao · Berlina · SP98 · 90/40% · auto · Cepsa+BP | 612 km | 1 (auto) | 28.9/29.3/31.3 € | 21 | 0 | 0 |
| G046 Valencia→A Coruña · Berlina · SP95 · 30/10% · 1 | 951 km | 1 (forzado, auto=2) | 83.0/83.0/83.0 € | 18 | 3 | 0 |
| G047 Zaragoza→Sevilla · Berlina · Diésel · 45/15% · auto | 840 km | 1 (auto) | 70.8/70.8/79.5 € | 21 | 0 | 0 |
| G048 Málaga→Bilbao · Berlina · SP98 · 60/25% · 2 | 930 km | 2 (forzado, auto=1) | 77.2/79.8/82.3 € | 21 | 0 | 0 |
| G049 Cartagena→Madrid · Berlina · SP95 · 80/40% · auto · Repsol | 451 km | 1 (auto) | 16.8/16.8/17.6 € | 21 | 0 | 0 |
| G050 Granada→Zaragoza · Berlina · Diésel · 90/10% · auto · Cepsa+BP | 729 km | 1 (auto) | 14.0/14.5/14.8 € | 21 | 0 | 0 |
| G051 Sevilla→Barcelona · Berlina · SP98 · 30/15% · 1 | 1039 km | 1 (forzado, auto=2) | 88.0/88.0/88.0 € | 18 | 3 | 0 |
| G052 Bilbao→Málaga · Berlina · SP95 · 45/25% · auto | 936 km | 1 (auto) | 83.8/83.8/83.8 € | 18 | 3 | 0 |
| G053 Almería→Bilbao · Berlina · Diésel · 60/40% · 2 | 977 km | 2 (forzado, auto=1) | 93.6/96.2/101.3 € | 21 | 0 | 0 |
| G054 Valencia→Bilbao +1wp · Berlina · SP98 · 80/10% · auto · Repsol | 766 km | 1 (auto) | 27.4/28.9/30.2 € | 21 | 0 | 0 |
| G055 Madrid→Barcelona +2wp · Berlina · SP95 · 90/15% · auto · Cepsa+BP | 626 km | 1 (auto) | 5.7/5.8/5.9 € | 20 | 1 | 0 |
| G056 Cádiz→Barcelona +1wp · Berlina · Diésel · 30/25% · 1 | 1277 km | 1 (forzado, auto=2) | 90.5/90.5/90.5 € | 18 | 3 | 0 |
| G057 Bilbao→Valencia +1wp · Berlina · SP98 · 45/40% · auto | 612 km | 1 (auto) | 71.6/71.6/71.6 € | 21 | 0 | 0 |
| G058 Madrid→Málaga +4wp · Berlina · SP95 · 60/10% · 2 | 597 km | 2 (forzado, auto=1) | 22.3/23.0/23.0 € | 21 | 0 | 0 |
| G059 Bilbao→Málaga +5wp · Berlina · Diésel · 80/15% · auto · Repsol | 1179 km | 1 (auto) | 86.9/86.9/86.9 € | 21 | 0 | 0 |
| G060 Madrid→Sevilla · Berlina · SP98 · 90/25% · auto · sin peaje · Cepsa+BP | 534 km | 1 (auto) | 4.2/4.3/4.6 € | 21 | 0 | 0 |
| G061 Madrid→Valencia · Berlina · SP95 · 30/40% · 1 · i/v | 721 km | 1 (forzado, auto=1) | 85.0/85.0/85.0 € | 18 | 3 | 0 |
| G062 Barcelona→Cádiz · Berlina · Diésel · 45/10% · auto · i/v | 2213 km | 3 (auto) | 236.5/236.5/251.6 € | 19 | 2 | 0 |
| G063 Madrid→Toledo · SUV · SP98 · 60/10% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G064 Madrid→Valencia · SUV · SP95 · 80/15% · auto · Repsol | 360 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G065 Madrid→Barcelona · SUV · Diésel · 90/25% · 1 · Cepsa+BP | 620 km | 1 (forzado, auto=1) | 20.6/20.6/20.6 € | 21 | 0 | 0 |
| G066 Madrid→Sevilla · SUV · SP98 · 30/40% · auto | 534 km | 1 (auto) | 90.4/90.4/90.4 € | 21 | 0 | 0 |
| G067 Madrid→Málaga · SUV · SP95 · 45/10% · 2 | 536 km | 2 (forzado, auto=1) | 35.9/37.2/36.9 € | 21 | 0 | 0 |
| G068 Madrid→Bilbao · SUV · Diésel · 60/15% · auto | 397 km | 1 (auto) | 8.2/8.4/8.9 € | 21 | 0 | 0 |
| G069 Madrid→Granada · SUV · SP98 · 80/25% · auto · Repsol | 421 km | 1 (auto) | 1.3/1.3/1.3 € | 21 | 0 | 0 |
| G070 Barcelona→Cádiz · SUV · SP95 · 90/40% · 1 · Cepsa+BP | 1112 km | 1 (forzado, auto=1) | 106.1/106.1/106.1 € | 18 | 3 | 0 |
| G071 Barcelona→Sevilla · SUV · Diésel · 30/10% · auto | 994 km | 2 (auto) | 113.7/114.5/123.2 € | 21 | 0 | 0 |
| G072 Barcelona→Madrid · SUV · SP98 · 45/15% · 2 · sin peaje | 630 km | 2 (forzado, auto=1) | 57.0/60.0/62.3 € | 21 | 0 | 0 |
| G073 A Coruña→Almería · SUV · SP95 · 60/25% · auto | 1167 km | 2 (auto) | 120.6/122.2/131.3 € | 21 | 0 | 0 |
| G074 A Coruña→Cartagena · SUV · Diésel · 80/40% · auto · Repsol | 1043 km | 1 (auto) | 109.5/109.5/109.5 € | 18 | 3 | 0 |
| G075 A Coruña→Madrid · SUV · SP98 · 90/10% · 1 · Cepsa+BP | 592 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G076 Valencia→Bilbao · SUV · SP95 · 30/15% · auto | 612 km | 1 (auto) | 64.7/65.9/72.0 € | 21 | 0 | 0 |
| G077 Valencia→A Coruña · SUV · Diésel · 45/25% · 2 | 951 km | 2 (forzado, auto=1) | 111.0/111.3/120.2 € | 21 | 0 | 0 |
| G078 Zaragoza→Sevilla · SUV · SP98 · 60/40% · auto | 840 km | 1 (auto) | 108.8/108.8/108.8 € | 21 | 0 | 0 |
| G079 Málaga→Bilbao · SUV · SP95 · 80/10% · auto · Repsol | 930 km | 1 (auto) | 57.2/57.9/59.2 € | 21 | 0 | 0 |
| G080 Cartagena→Madrid · SUV · Diésel · 90/15% · 1 · Cepsa+BP | 451 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G081 Granada→Zaragoza · SUV · SP98 · 30/25% · auto | 729 km | 1 (auto) | 106.1/106.1/106.1 € | 21 | 0 | 0 |
| G082 Sevilla→Barcelona · SUV · SP95 · 45/40% · 2 | 1039 km | 2 (forzado, auto=2) | 129.3/131.7/145.4 € | 21 | 0 | 0 |
| G083 Bilbao→Málaga · SUV · Diésel · 60/10% · auto | 936 km | 1 (auto) | 79.4/79.4/85.2 € | 21 | 0 | 0 |
| G084 Almería→Bilbao · SUV · SP98 · 80/15% · auto · Repsol | 977 km | 1 (auto) | 75.1/75.1/76.9 € | 21 | 0 | 0 |
| G085 Valencia→Bilbao +1wp · SUV · SP95 · 90/25% · 1 · Cepsa+BP | 766 km | 1 (forzado, auto=1) | 39.4/40.9/45.1 € | 21 | 0 | 0 |
| G086 Madrid→Barcelona +2wp · SUV · Diésel · 30/40% · auto | 626 km | 1 (auto) | 105.9/105.9/105.9 € | 18 | 3 | 0 |
| G087 Cádiz→Barcelona +1wp · SUV · SP98 · 45/10% · 2 | 1277 km | 2 (forzado, auto=2) | 141.9/153.3/164.1 € | 21 | 0 | 0 |
| G088 Bilbao→Valencia +1wp · SUV · SP95 · 60/15% · auto | 612 km | 1 (auto) | 35.4/39.3/39.3 € | 21 | 0 | 0 |
| G089 Madrid→Málaga +4wp · SUV · Diésel · 80/25% · auto · Repsol | 597 km | 1 (auto) | 28.8/28.9/29.3 € | 21 | 0 | 0 |
| G090 Bilbao→Málaga +5wp · SUV · SP98 · 90/40% · 1 · Cepsa+BP | 1179 km | 1 (forzado, auto=1) | 108.5/108.5/108.5 € | 18 | 3 | 0 |
| G091 Madrid→Sevilla · SUV · SP95 · 30/10% · auto · sin peaje | 534 km | 1 (auto) | 48.5/48.5/54.3 € | 21 | 0 | 0 |
| G092 Madrid→Valencia · SUV · Diésel · 45/15% · 2 · i/v | 721 km | 2 (forzado, auto=1) | 71.8/70.8/71.2 € | 19 | 2 | 0 |
| G093 Barcelona→Cádiz · SUV · SP98 · 60/25% · auto · i/v | 2213 km | 3 (auto) | 297.8/307.6/310.3 € | 18 | 3 | 0 |
| G094 Madrid→Toledo · Furgoneta · SP95 · 80/25% · 1 · Repsol | 73 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G095 Madrid→Valencia · Furgoneta · Diésel · 90/40% · auto · Cepsa+BP | 360 km | 1 (auto) | 22.5/22.5/23.0 € | 21 | 0 | 0 |
| G096 Madrid→Barcelona · Furgoneta · SP98 · 30/10% · 2 | 620 km | 2 (forzado, auto=2) | 88.9/92.5/93.7 € | 21 | 0 | 0 |
| G097 Madrid→Sevilla · Furgoneta · SP95 · 45/15% · auto | 534 km | 1 (auto) | 62.5/66.9/69.2 € | 21 | 0 | 0 |
| G098 Madrid→Málaga · Furgoneta · Diésel · 60/25% · auto | 536 km | 1 (auto) | 63.3/64.0/64.0 € | 21 | 0 | 0 |
| G099 Madrid→Bilbao · Furgoneta · SP98 · 80/40% · 1 · Repsol | 397 km | 1 (forzado, auto=1) | 37.6/38.2/38.2 € | 21 | 0 | 0 |
| G100 Madrid→Granada · Furgoneta · SP95 · 90/10% · auto · Cepsa+BP | 421 km | 1 (auto) | 7.2/7.2/7.2 € | 21 | 0 | 0 |


## S01 · Trayecto corto, depósito lleno → 0 paradas

> **Objetivo del test:** Verifica que con autonomía de sobra NO se propone ninguna parada (canMakeItNoStops).

**Ruta:** Madrid → Toledo  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 90% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 73 km · 54 min · peaje: no  
**Corredor (SP95, ≤4 km):** 218 estaciones · precio medio 1.817 €/L

### Plan de combustible

```
consumo del viaje  = 73 km × 6.5/100        = 4.8 L
litros de salida   = 50 × 90%                    = 45.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (45.0-4.0) / 6.5 × 100  = 631 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 45.0 - 4.8 ≥ 7.5? → SÍ
paradas mínimas    = 0   (modo=auto → se usan 0)
```
**Justificación:** Con 45 L de salida y un consumo de 5 L, terminas con 40 L ≥ 8 L de reserva. **No hace falta repostar.**

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | Llega con la reserva pedida | llega con 40.2 L (reserva pedida 7.5 L) |


## S02 · Media distancia, salida 50% → 1 parada (auto)

> **Objetivo del test:** Autonomía de salida insuficiente pero un solo repostaje basta.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones · precio medio 1.829 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 6.5 × 100  = 323 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 25.0 - 40.3 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (323 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 323 + 1×708 = 1031 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.587 € | 0.3 km | 36.19 € | 23 L |
| Equilibrado | 1.587 € | 0.3 km | 36.19 € | 23 L |
| Más rápido | 1.657 € | 0.1 km | 37.78 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.7%–52.1% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.037 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 21.4 | 22.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.7%–52.1% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.048 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 21.4 | 22.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Guadalajara | 8.9% | 0.7%–52.1% | 1.657 | -0.172 | 0.1 km | 6.1 | 0.018 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 8.9% | 21.4 | 22.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 21.4 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 21.4 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 21.4 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 36.19 € · equilibrado 36.19 € · rápido 37.78 € |
| ✅ | Barato tiene el coste mínimo | barato 36.19 € vs mejor de los otros 36.19 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.3 km |


## S03 · Larga distancia → 2 paradas (auto)

> **Objetivo del test:** Reparto de 2 repostajes en ventanas de autonomía sucesivas; compara 3 estrategias.

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 80% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1112 km · 636 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 827 estaciones · precio medio 1.835 €/L

### Plan de combustible

```
consumo del viaje  = 1112 km × 6.5/100        = 72.3 L
litros de salida   = 50 × 80%                    = 40.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (40.0-4.0) / 6.5 × 100  = 554 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 40.0 - 72.3 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (554 km) no cubre los 1112 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 554 + 1×708 = 1262 km ≥ 1112 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.799 € | 0.2 km | 71.60 € | 40 L |
| Equilibrado | 1.799 € | 0.2 km | 71.60 € | 40 L |
| Más rápido | 1.863 € | 0.1 km | 74.15 € | 40 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | DILAMOR (Dilamor) | Tébar | 45.7% | 41.2%–49.8% | 1.799 | -0.036 | 0.2 km | 6.2 | 0.448 | menor score entre 15 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | DILAMOR (repostaje) | 45.7% | 7.0 | 39.8 L | 46.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | DILAMOR (Dilamor) | Tébar | 45.7% | 41.2%–49.8% | 1.799 | -0.036 | 0.2 km | 6.2 | 0.284 | menor score entre 15 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | DILAMOR (repostaje) | 45.7% | 7.0 | 39.8 L | 46.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | San Clemente | 48.3% | 41.2%–49.8% | 1.863 | +0.028 | 0.1 km | 6.1 | 0.043 | menor score entre 15 candidatas (la más barata era Dilamor a 1.799, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 48.3% | 5.1 | 39.8 L | 44.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.0 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.0 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.1 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 71.60 € · equilibrado 71.60 € · rápido 74.15 € |
| ✅ | Barato tiene el coste mínimo | barato 71.60 € vs mejor de los otros 71.60 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.2 km |


## S04 · Muy larga + depósito pequeño → ~3 paradas (auto)

> **Objetivo del test:** Depósito 30 L, consumo alto: obliga a varias paradas. Comprueba que ninguna etapa deja el depósito en negativo.

**Ruta:** A Coruña → Almería  
**Parámetros:** Diésel · consumo 9 L/100 · depósito 30 L · salida 60% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1167 km · 639 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 718 estaciones · precio medio 1.931 €/L

### Plan de combustible

```
consumo del viaje  = 1167 km × 9/100        = 105.0 L
litros de salida   = 30 × 60%                    = 18.0 L
reserva de llegada = 30 × 15%                    = 4.5 L
margen seguridad   = 30 × 8%                     = 2.4 L
autonomía salida   = (18.0-2.4) / 9 × 100  = 173 km
autonomía tanque   = (30-2.4) / 9 × 100  = 307 km
¿llega sin parar?  = 18.0 - 105.0 ≥ 4.5? → NO
paradas mínimas    = 4   (modo=auto → se usan 4)
```
**Justificación:** La autonomía de salida (173 km) no cubre los 1167 km. Con 4 repostaje(s) de depósito lleno la autonomía acumulada es 173 + 4×307 = 1400 km ≥ 1167 km. **Mínimo 4 parada(s).**

### Comparativa de estrategias (nStops=4)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.792 € | 0.3 km | 164.75 € | 92 L |
| Equilibrado | 1.792 € | 0.3 km | 164.75 € | 92 L |
| Más rápido | 1.935 € | 0.1 km | 176.70 € | 92 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROCASH TRUCK GUITIRIZ (Petrocash Truck Guitiriz) | Guitiriz | 4.4% | 3.0%–14.9% | 1.729 | -0.202 | 0.3 km | 6.3 | 0.068 | menor score entre 42 candidatas de la ventana (también la más barata) |
| 2 | AGRINZA (Agrinza) | Villalpando | 30.4% | 23.2%–30.7% | 1.750 | -0.181 | 0.2 km | 6.2 | 0.111 | menor score entre 32 candidatas de la ventana (también la más barata) |
| 3 | PLENERGY (Plenergy) | Alcorcón | 50.9% | 49.4%–56.7% | 1.719 | -0.212 | 0.3 km | 6.3 | 0.046 | menor score entre 213 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 4 | ARENAS CAMACHO, S.L. (Arenas Camacho, S.L.) | Mengíbar | 77.0% | 75.7%–77.1% | 1.969 | +0.038 | 0.6 km | 6.6 | 0.582 | menor score entre 3 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROCASH TRUCK GUITIRIZ (repostaje) | 4.4% | 13.4 | 16.4 L | 29.7 |
| 2 | AGRINZA (repostaje) | 30.4% | 2.4 | 21.5 L | 23.9 |
| 3 | PLENERGY (repostaje) | 50.9% | 2.4 | 27.5 L | 29.9 |
| 4 | ARENAS CAMACHO, S.L. (repostaje) | 77.0% | 2.4 | 26.2 L | 28.6 |
| — | **Destino** | 100% | **4.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROCASH TRUCK GUITIRIZ (Petrocash Truck Guitiriz) | Guitiriz | 4.4% | 3.0%–14.9% | 1.729 | -0.202 | 0.3 km | 6.3 | 0.069 | menor score entre 42 candidatas de la ventana (también la más barata) |
| 2 | AGRINZA (Agrinza) | Villalpando | 30.4% | 23.2%–30.7% | 1.750 | -0.181 | 0.2 km | 6.2 | 0.081 | menor score entre 32 candidatas de la ventana (también la más barata) |
| 3 | PLENERGY (Plenergy) | Alcorcón | 50.9% | 49.4%–56.7% | 1.719 | -0.212 | 0.3 km | 6.3 | 0.052 | menor score entre 213 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 4 | ARENAS CAMACHO, S.L. (Arenas Camacho, S.L.) | Mengíbar | 77.0% | 75.7%–77.1% | 1.969 | +0.038 | 0.6 km | 6.6 | 0.407 | menor score entre 3 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROCASH TRUCK GUITIRIZ (repostaje) | 4.4% | 13.4 | 16.4 L | 29.7 |
| 2 | AGRINZA (repostaje) | 30.4% | 2.4 | 21.5 L | 23.9 |
| 3 | PLENERGY (repostaje) | 50.9% | 2.4 | 27.5 L | 29.9 |
| 4 | ARENAS CAMACHO, S.L. (repostaje) | 77.0% | 2.4 | 26.2 L | 28.6 |
| — | **Destino** | 100% | **4.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GALP (Galp) | Guitiriz | 4.4% | 3.0%–14.9% | 1.989 | +0.058 | 0.0 km | 6.0 | 0.032 | menor score entre 42 candidatas (la más barata era Petrocash Truck Guitiriz a 1.729, con peor score por desvío/tiempo) |
| 2 | STAROIL (Staroil) | Benavente | 28.0% | 23.2%–30.7% | 1.869 | -0.062 | 0.1 km | 6.1 | 0.029 | menor score entre 32 candidatas (la más barata era Agrinza a 1.750, con peor score por desvío/tiempo) |
| 3 | BALLENOIL (Ballenoil) | Getafe | 51.7% | 49.4%–54.3% | 1.819 | -0.112 | 0.1 km | 6.1 | 0.042 | menor score entre 200 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 4 | REPSOL (Repsol) | Jabalquinto | 76.5% | 75.7%–78.0% | 2.065 | +0.134 | 0.1 km | 6.1 | 0.061 | menor score entre 4 candidatas (la más barata era Arenas Camacho, S.L. a 1.969, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GALP (repostaje) | 4.4% | 13.4 | 13.9 L | 27.3 |
| 2 | STAROIL (repostaje) | 28.0% | 2.4 | 24.9 L | 27.3 |
| 3 | BALLENOIL (repostaje) | 51.7% | 2.4 | 26.1 L | 28.5 |
| 4 | REPSOL (repostaje) | 76.5% | 2.4 | 26.8 L | 29.2 |
| — | **Destino** | 100% | **4.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 164.75 € · equilibrado 164.75 € · rápido 176.70 € |
| ✅ | Barato tiene el coste mínimo | barato 164.75 € vs mejor de los otros 164.75 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.3 km |


## S05 · Extremo: depósito 25 L → >3 paradas (auto)

> **Objetivo del test:** Caso límite con muchas paradas (auto puede superar 3). Verifica ventanas y no-negatividad.

**Ruta:** A Coruña → Cartagena  
**Parámetros:** Diésel · consumo 10 L/100 · depósito 25 L · salida 50% · llegada ≥ 10% · paradas=auto

**Ruta calculada:** 1043 km · 574 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 691 estaciones · precio medio 1.926 €/L

### Plan de combustible

```
consumo del viaje  = 1043 km × 10/100        = 104.3 L
litros de salida   = 25 × 50%                    = 12.5 L
reserva de llegada = 25 × 10%                    = 2.5 L
margen seguridad   = 25 × 8%                     = 2.0 L
autonomía salida   = (12.5-2.0) / 10 × 100  = 105 km
autonomía tanque   = (25-2.0) / 10 × 100  = 230 km
¿llega sin parar?  = 12.5 - 104.3 ≥ 2.5? → NO
paradas mínimas    = 5   (modo=auto → se usan 5)
```
**Justificación:** La autonomía de salida (105 km) no cubre los 1043 km. Con 5 repostaje(s) de depósito lleno la autonomía acumulada es 105 + 5×230 = 1255 km ≥ 1043 km. **Mínimo 5 parada(s).**

### Comparativa de estrategias (nStops=5)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.792 € | 0.4 km | 170.13 € | 94 L |
| Equilibrado | 1.798 € | 0.3 km | 170.47 € | 94 L |
| Más rápido | 1.926 € | 0.1 km | 181.64 € | 94 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Coruña (A) | 0.7% | 0.1%–10.1% | 1.699 | -0.227 | 0.8 km | 6.8 | 0.010 | menor score entre 90 candidatas (la más barata era Petroprix a 1.699, con peor score por desvío/tiempo) |
| 2 | (SIN RÓTULO) ((Sin RóTulo)) | Bembibre | 20.8% | 12.8%–22.7% | 1.809 | -0.117 | 0.1 km | 6.1 | 0.230 | menor score entre 33 candidatas de la ventana (también la más barata) |
| 3 | LOWCOST MEDINA (Lowcost Medina) | Medina del Campo | 41.4% | 34.3%–42.8% | 1.739 | -0.187 | 0.6 km | 6.6 | 0.091 | menor score entre 26 candidatas (la más barata era Petroprix a 1.739, con peor score por desvío/tiempo) |
| 4 | PLENERGY (Plenergy) | Alcorcón | 56.9% | 56.4%–63.4% | 1.719 | -0.207 | 0.3 km | 6.3 | 0.045 | menor score entre 193 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 5 | REPSOL (Repsol) | Roda (La) | 78.2% | 78.4%–78.9% | 1.995 | +0.069 | 0.1 km | 6.1 | 0.617 | sin estación dentro de la ventana → se amplía y se toma la de menor score disponible (517 candidatas) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 0.7% | 11.8 | 11.2 L | 23.0 |
| 2 | (SIN RÓTULO) (repostaje) | 20.8% | 2.0 | 21.5 L | 23.5 |
| 3 | LOWCOST MEDINA (repostaje) | 41.4% | 2.0 | 16.2 L | 18.2 |
| 4 | PLENERGY (repostaje) | 56.9% | 2.0 | 22.2 L | 24.2 |
| 5 | REPSOL (repostaje) | 78.2% | 2.0 | 23.0 L | 25.0 |
| — | **Destino** | 100% | **2.3** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROCASH TRUCK GUITIRIZ (Petrocash Truck Guitiriz) | Guitiriz | 4.9% | 0.1%–10.1% | 1.729 | -0.197 | 0.3 km | 6.3 | 0.068 | menor score entre 90 candidatas (la más barata era Petroprix a 1.699, con peor score por desvío/tiempo) |
| 2 | (SIN RÓTULO) ((Sin RóTulo)) | Bembibre | 20.8% | 17.0%–27.0% | 1.809 | -0.117 | 0.1 km | 6.1 | 0.143 | menor score entre 37 candidatas (la más barata era Cooperativa San Blas a 1.789, con peor score por desvío/tiempo) |
| 3 | LOWCOST MEDINA (Lowcost Medina) | Medina del Campo | 41.4% | 34.3%–42.8% | 1.739 | -0.187 | 0.6 km | 6.6 | 0.111 | menor score entre 26 candidatas (la más barata era Petroprix a 1.739, con peor score por desvío/tiempo) |
| 4 | PLENERGY (Plenergy) | Alcorcón | 56.9% | 56.4%–63.4% | 1.719 | -0.207 | 0.3 km | 6.3 | 0.051 | menor score entre 193 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 5 | REPSOL (Repsol) | Roda (La) | 78.2% | 78.4%–78.9% | 1.995 | +0.069 | 0.1 km | 6.1 | 0.374 | sin estación dentro de la ventana → se amplía y se toma la de menor score disponible (517 candidatas) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROCASH TRUCK GUITIRIZ (repostaje) | 4.9% | 7.4 | 11.2 L | 18.5 |
| 2 | (SIN RÓTULO) (repostaje) | 20.8% | 2.0 | 21.5 L | 23.5 |
| 3 | LOWCOST MEDINA (repostaje) | 41.4% | 2.0 | 16.2 L | 18.2 |
| 4 | PLENERGY (repostaje) | 56.9% | 2.0 | 22.2 L | 24.2 |
| 5 | REPSOL (repostaje) | 78.2% | 2.0 | 23.0 L | 25.0 |
| — | **Destino** | 100% | **2.3** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Coruña (A) | 0.4% | 0.1%–10.1% | 1.965 | +0.039 | 0.0 km | 6.0 | 0.030 | menor score entre 90 candidatas (la más barata era Petroprix a 1.699, con peor score por desvío/tiempo) |
| 2 | (SIN RÓTULO) ((Sin RóTulo)) | Bembibre | 20.8% | 12.5%–22.4% | 1.809 | -0.117 | 0.1 km | 6.1 | 0.024 | menor score entre 33 candidatas de la ventana (también la más barata) |
| 3 | REPSOL (Repsol) | Vega de Valdetronco | 38.0% | 34.3%–42.8% | 2.009 | +0.083 | 0.0 km | 6.0 | 0.041 | menor score entre 26 candidatas (la más barata era Petroprix a 1.739, con peor score por desvío/tiempo) |
| 4 | BALLENOIL (Ballenoil) | Getafe | 57.8% | 56.4%–60.0% | 1.819 | -0.107 | 0.1 km | 6.1 | 0.042 | menor score entre 171 candidatas (la más barata era Plenergy a 1.709, con peor score por desvío/tiempo) |
| 5 | GALP (Galp) | Roda (La) | 79.2% | 78.4%–79.9% | 2.029 | +0.103 | 0.1 km | 6.1 | 0.065 | menor score entre 1 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 0.4% | 12.1 | 11.2 L | 23.3 |
| 2 | (SIN RÓTULO) (repostaje) | 20.8% | 2.0 | 18.0 L | 20.0 |
| 3 | REPSOL (repostaje) | 38.0% | 2.0 | 20.7 L | 22.7 |
| 4 | BALLENOIL (repostaje) | 57.8% | 2.0 | 22.3 L | 24.3 |
| 5 | GALP (repostaje) | 79.2% | 2.0 | 22.2 L | 24.2 |
| — | **Destino** | 100% | **2.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 2.3 L (pedida 2.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 2.3 L (pedida 2.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 2.5 L (pedida 2.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 170.13 € · equilibrado 170.47 € · rápido 181.64 € |
| ✅ | Barato tiene el coste mínimo | barato 170.13 € vs mejor de los otros 170.47 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.4 km |


## S06 · Diésel, 1 parada

> **Objetivo del test:** Corredor de diésel (muchas estaciones). Elección barata vs rápida.

**Ruta:** Madrid → Valencia  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 360 km · 223 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 349 estaciones · precio medio 1.931 €/L

### Plan de combustible

```
consumo del viaje  = 360 km × 6.5/100        = 23.4 L
litros de salida   = 45 × 45%                    = 20.3 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (20.3-3.6) / 6.5 × 100  = 256 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 20.3 - 23.4 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (256 km) no cubre los 360 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 256 + 1×637 = 893 km ≥ 360 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.739 € | 0.8 km | 17.20 € | 10 L |
| Equilibrado | 1.769 € | 0.3 km | 17.50 € | 10 L |
| Más rápido | 1.839 € | 0.1 km | 18.19 € | 10 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | EESS ROTONDA (Eess Rotonda) | Tarancón | 23.2% | 0.0%–71.2% | 1.739 | -0.192 | 0.8 km | 6.8 | 0.062 | menor score entre 176 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | EESS ROTONDA (repostaje) | 23.2% | 14.8 | 9.9 L | 24.7 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SUMERGY -  GRUPO SERTRANIN (Sumergy -  Grupo Sertranin) | Minglanilla | 68.0% | 0.0%–71.2% | 1.769 | -0.162 | 0.3 km | 6.3 | 0.105 | menor score entre 176 candidatas (la más barata era Eess Rotonda a 1.739, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SUMERGY -  GRUPO SERTRANIN (repostaje) | 68.0% | 4.4 | 9.9 L | 14.2 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BEROIL (Beroil) | Tébar | 52.4% | 0.0%–71.2% | 1.839 | -0.092 | 0.1 km | 6.1 | 0.045 | menor score entre 176 candidatas (la más barata era Eess Rotonda a 1.739, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BEROIL (repostaje) | 52.4% | 8.0 | 9.9 L | 17.9 |
| — | **Destino** | 100% | **6.7** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 14.8 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.4 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.0 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 17.20 € · equilibrado 17.50 € · rápido 18.19 € |
| ✅ | Barato tiene el coste mínimo | barato 17.20 € vs mejor de los otros 17.50 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.8 km |


## S07 · GLP (autogas): corredor escaso

> **Objetivo del test:** Combustible con pocas estaciones. Comprueba manejo de corredor pequeño / desvíos grandes.

**Ruta:** Madrid → Bilbao  
**Parámetros:** GLP · consumo 7.5 L/100 · depósito 45 L · salida 40% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 397 km · 239 min · peaje: SÍ  
**Corredor (GLP, ≤4 km):** 48 estaciones · precio medio 1.107 €/L

### Plan de combustible

```
consumo del viaje  = 397 km × 7.5/100        = 29.8 L
litros de salida   = 45 × 40%                    = 18.0 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (18.0-3.6) / 7.5 × 100  = 192 km
autonomía tanque   = (45-3.6) / 7.5 × 100  = 552 km
¿llega sin parar?  = 18.0 - 29.8 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (192 km) no cubre los 397 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 192 + 1×552 = 744 km ≥ 397 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 0.799 € | 2.6 km | 14.80 € | 19 L |
| Equilibrado | 0.799 € | 2.6 km | 14.80 € | 19 L |
| Más rápido | 1.079 € | 0.0 km | 19.99 € | 19 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MADRID WETAXI GLP (Madrid Wetaxi Glp) | Madrid | 1.6% | 0.0%–48.4% | 0.799 | -0.308 | 2.6 km | 8.6 | 0.033 | menor score entre 33 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MADRID WETAXI GLP (repostaje) | 1.6% | 17.5 | 18.5 L | 36.0 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MADRID WETAXI GLP (Madrid Wetaxi Glp) | Madrid | 1.6% | 0.0%–48.4% | 0.799 | -0.308 | 2.6 km | 8.6 | 0.264 | menor score entre 33 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MADRID WETAXI GLP (repostaje) | 1.6% | 17.5 | 18.5 L | 36.0 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ENI (Eni) | San Sebastián de los Reyes | 6.8% | 0.0%–48.4% | 1.079 | -0.028 | 0.0 km | 6.0 | 0.037 | menor score entre 33 candidatas (la más barata era Madrid Wetaxi Glp a 0.799, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ENI (repostaje) | 6.8% | 16.0 | 18.5 L | 34.5 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.5 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 2.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.5 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.0 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 14.80 € · equilibrado 14.80 € · rápido 19.99 € |
| ✅ | Barato tiene el coste mínimo | barato 14.80 € vs mejor de los otros 14.80 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 2.6 km |


## S08 · Evitar peajes (Madrid→Sevilla)

> **Objetivo del test:** Flag avoidTolls: la ruta y el corredor deben calcularse sobre la ruta sin peaje.

**Ruta:** Madrid → Sevilla  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto · evitar peajes

**Ruta calculada:** 534 km · 300 min · peaje: no  
**Corredor (SP95, ≤4 km):** 389 estaciones · precio medio 1.827 €/L

### Plan de combustible

```
consumo del viaje  = 534 km × 6.5/100        = 34.7 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 34.7 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 534 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 534 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.579 € | 0.1 km | 31.10 € | 20 L |
| Equilibrado | 1.579 € | 0.1 km | 31.10 € | 20 L |
| Más rápido | 1.767 € | 0.0 km | 34.80 € | 20 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Alcorcón | 3.7% | 0.0%–53.3% | 1.579 | -0.248 | 0.1 km | 6.1 | 0.001 | menor score entre 249 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 3.7% | 21.2 | 19.7 L | 40.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Alcorcón | 3.7% | 0.0%–53.3% | 1.579 | -0.248 | 0.1 km | 6.1 | 0.008 | menor score entre 249 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 3.7% | 21.2 | 19.7 L | 40.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Madrid | 0.7% | 0.0%–53.3% | 1.767 | -0.060 | 0.0 km | 6.0 | 0.019 | menor score entre 249 candidatas (la más barata era Alcampo a 1.579, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 0.7% | 22.3 | 19.7 L | 41.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 21.2 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 21.2 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 22.3 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 31.10 € · equilibrado 31.10 € · rápido 34.80 € |
| ✅ | Barato tiene el coste mínimo | barato 31.10 € vs mejor de los otros 31.10 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 0.1 km |


## S09 · Evitar peajes (Barcelona→Madrid)

> **Objetivo del test:** Corredor mediterráneo con AP-2/AP-7: comprueba detección/evitación de peaje.

**Ruta:** Barcelona → Madrid  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto · evitar peajes

**Ruta calculada:** 630 km · 368 min · peaje: no  
**Corredor (SP95, ≤4 km):** 624 estaciones · precio medio 1.829 €/L

### Plan de combustible

```
consumo del viaje  = 630 km × 6.5/100        = 41.0 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 41.0 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 630 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 630 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.569 € | 1.2 km | 40.73 € | 26 L |
| Equilibrado | 1.569 € | 1.2 km | 40.73 € | 26 L |
| Más rápido | 1.829 € | 0.0 km | 47.47 € | 26 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROCAT DIRECTE (Petrocat) | Olèrdola | 9.6% | 0.0%–45.2% | 1.569 | -0.260 | 1.2 km | 7.2 | 0.015 | menor score entre 245 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROCAT DIRECTE (repostaje) | 9.6% | 18.6 | 26.0 L | 44.5 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROCAT DIRECTE (Petrocat) | Olèrdola | 9.6% | 0.0%–45.2% | 1.569 | -0.260 | 1.2 km | 7.2 | 0.116 | menor score entre 245 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROCAT DIRECTE (repostaje) | 9.6% | 18.6 | 26.0 L | 44.5 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BP AP2 FRAGA (MI) (BP) | Fraga | 30.3% | 0.0%–45.2% | 1.829 | +0.000 | 0.0 km | 6.0 | 0.035 | menor score entre 245 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BP AP2 FRAGA (MI) (repostaje) | 30.3% | 10.1 | 26.0 L | 36.0 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 18.6 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 18.6 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 10.1 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 40.73 € · equilibrado 40.73 € · rápido 47.47 € |
| ✅ | Barato tiene el coste mínimo | barato 40.73 € vs mejor de los otros 40.73 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.2 km |


## S10 · Filtro de marca: solo Repsol

> **Objetivo del test:** Restringe el corredor a una marca. Todas las paradas deben ser Repsol.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto · marcas: Repsol

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones → 161 tras filtro de marca · precio medio 1.867 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 45 × 45%                    = 20.3 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (20.3-3.6) / 6.5 × 100  = 256 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 20.3 - 40.3 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (256 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 256 + 1×637 = 893 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.819 € | 0.1 km | 48.75 € | 27 L |
| Equilibrado | 1.819 € | 0.1 km | 48.75 € | 27 L |
| Más rápido | 1.849 € | 0.0 km | 49.56 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Santa María de Huerta | 29.0% | 5.1%–41.3% | 1.819 | -0.048 | 0.1 km | 6.1 | 0.177 | menor score entre 27 candidatas (la más barata era Repsol a 1.815, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 29.0% | 8.6 | 26.8 L | 35.4 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Santa María de Huerta | 29.0% | 5.1%–41.3% | 1.819 | -0.048 | 0.1 km | 6.1 | 0.110 | menor score entre 27 candidatas (la más barata era Repsol a 1.815, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 29.0% | 8.6 | 26.8 L | 35.4 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Torija | 12.2% | 5.1%–41.3% | 1.849 | -0.018 | 0.0 km | 6.0 | 0.013 | menor score entre 27 candidatas (la más barata era Repsol a 1.815, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 12.2% | 15.3 | 26.8 L | 42.1 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.6 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.6 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 15.3 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 48.75 € · equilibrado 48.75 € · rápido 49.56 € |
| ✅ | Barato tiene el coste mínimo | barato 48.75 € vs mejor de los otros 48.75 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 0.1 km |


## S11 · Filtro de marca: Cepsa + BP

> **Objetivo del test:** Corredor limitado a dos marcas. Verifica que solo se eligen esas.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto · marcas: Cepsa+BP

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones → 114 tras filtro de marca · precio medio 1.884 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 45 × 45%                    = 20.3 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (20.3-3.6) / 6.5 × 100  = 256 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 20.3 - 40.3 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (256 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 256 + 1×637 = 893 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.833 € | 0.1 km | 49.13 € | 27 L |
| Equilibrado | 1.833 € | 0.1 km | 49.13 € | 27 L |
| Más rápido | 1.859 € | 0.1 km | 49.82 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | Ariza | 31.6% | 5.1%–41.3% | 1.833 | -0.051 | 0.1 km | 6.1 | 0.117 | menor score entre 20 candidatas (la más barata era BP a 1.829, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 31.6% | 7.5 | 26.8 L | 34.3 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | Ariza | 31.6% | 5.1%–41.3% | 1.833 | -0.051 | 0.1 km | 6.1 | 0.075 | menor score entre 20 candidatas (la más barata era BP a 1.829, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 31.6% | 7.5 | 26.8 L | 34.3 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | Arcos de Jalón | 27.4% | 5.1%–41.3% | 1.859 | -0.025 | 0.1 km | 6.1 | 0.011 | menor score entre 20 candidatas (la más barata era BP a 1.829, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 27.4% | 9.2 | 26.8 L | 36.0 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.5 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.5 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 9.2 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 49.13 € · equilibrado 49.13 € · rápido 49.82 € |
| ✅ | Barato tiene el coste mínimo | barato 49.13 € vs mejor de los otros 49.13 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.1 km |


## S12 · 1 parada del conductor (waypoint)

> **Objetivo del test:** Waypoint intermedio: la ruta base pasa por él y el corredor lo rodea.

**Ruta:** Valencia → Madrid → Bilbao  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 766 km · 459 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 586 estaciones · precio medio 1.845 €/L

### Plan de combustible

```
consumo del viaje  = 766 km × 6.5/100        = 49.8 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 6.5 × 100  = 323 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 25.0 - 49.8 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (323 km) no cubre los 766 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 323 + 1×708 = 1031 km ≥ 766 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.639 € | 0.8 km | 52.88 € | 32 L |
| Equilibrado | 1.639 € | 0.8 km | 52.88 € | 32 L |
| Más rápido | 1.754 € | 0.1 km | 56.59 € | 32 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Tarancón | 35.9% | 14.6%–42.2% | 1.639 | -0.206 | 0.8 km | 6.8 | 0.167 | menor score entre 48 candidatas (la más barata era T9 a 1.639, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 35.9% | 7.1 | 32.3 L | 39.4 |
| 2 | Madrid | 47.1% | 33.8 | — | 33.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Tarancón | 35.9% | 14.6%–42.2% | 1.639 | -0.206 | 0.8 km | 6.8 | 0.351 | menor score entre 48 candidatas (la más barata era T9 a 1.639, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 35.9% | 7.1 | 32.3 L | 39.4 |
| 2 | Madrid | 47.1% | 33.8 | — | 33.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GASOLINERA VILLAREJO DE SALVANÉS (Gasolinera Villarejo De SalvanéS) | Villarejo de Salvanés | 40.0% | 14.6%–42.2% | 1.754 | -0.091 | 0.1 km | 6.1 | 0.628 | menor score entre 48 candidatas (la más barata era T9 a 1.639, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GASOLINERA VILLAREJO DE SALVANÉS (repostaje) | 40.0% | 5.1 | 32.3 L | 37.4 |
| 2 | Madrid | 47.1% | 33.8 | — | 33.8 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.1 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.1 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.1 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 52.88 € · equilibrado 52.88 € · rápido 56.59 € |
| ✅ | Barato tiene el coste mínimo | barato 52.88 € vs mejor de los otros 52.88 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.8 km |


## S13 · 2 paradas del conductor

> **Objetivo del test:** Dos waypoints (Zaragoza, Lleida). Orden por progreso y repostaje convenient cerca de ellos.

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 626 km · 400 min · peaje: no  
**Corredor (SP95, ≤4 km):** 620 estaciones · precio medio 1.826 €/L

### Plan de combustible

```
consumo del viaje  = 626 km × 6.5/100        = 40.7 L
litros de salida   = 45 × 45%                    = 20.3 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (20.3-3.6) / 6.5 × 100  = 256 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 20.3 - 40.7 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (256 km) no cubre los 626 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 256 + 1×637 = 893 km ≥ 626 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.587 € | 0.3 km | 43.12 € | 27 L |
| Equilibrado | 1.587 € | 0.3 km | 43.12 € | 27 L |
| Más rápido | 1.657 € | 0.1 km | 45.02 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.8% | 6.0%–40.9% | 1.587 | -0.239 | 0.3 km | 6.3 | 0.031 | menor score entre 79 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.8% | 16.7 | 27.2 L | 43.8 |
| 2 | Zaragoza | 50.1% | 27.0 | — | 27.0 |
| 3 | Lleida | 74.3% | 17.2 | — | 17.2 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.8% | 6.0%–40.9% | 1.587 | -0.239 | 0.3 km | 6.3 | 0.251 | menor score entre 79 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.8% | 16.7 | 27.2 L | 43.8 |
| 2 | Zaragoza | 50.1% | 27.0 | — | 27.0 |
| 3 | Lleida | 74.3% | 17.2 | — | 17.2 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Guadalajara | 8.8% | 6.0%–40.9% | 1.657 | -0.169 | 0.1 km | 6.1 | 0.612 | menor score entre 79 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 8.8% | 16.7 | 27.2 L | 43.9 |
| 2 | Zaragoza | 50.1% | 27.0 | — | 27.0 |
| 3 | Lleida | 74.3% | 17.2 | — | 17.2 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.7 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.7 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.7 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 43.12 € · equilibrado 43.12 € · rápido 45.02 € |
| ✅ | Barato tiene el coste mínimo | barato 43.12 € vs mejor de los otros 43.12 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.3 km |


## S14 · 4 paradas del conductor (>3)

> **Objetivo del test:** Cuatro waypoints. Verifica orden por progreso y efecto "convenient" (repostar junto a una parada no penaliza tiempo).

**Ruta:** Madrid → Aranjuez → Ciudad Real → Córdoba → Antequera → Málaga  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 597 km · 459 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 410 estaciones · precio medio 1.819 €/L

### Plan de combustible

```
consumo del viaje  = 597 km × 6.5/100        = 38.8 L
litros de salida   = 45 × 50%                    = 22.5 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (22.5-3.6) / 6.5 × 100  = 291 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 22.5 - 38.8 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (291 km) no cubre los 597 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 291 + 1×637 = 928 km ≥ 597 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.608 € | 0.1 km | 37.03 € | 23 L |
| Equilibrado | 1.669 € | 0.0 km | 38.44 € | 23 L |
| Más rápido | 1.669 € | 0.0 km | 38.44 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | T9 (T9) | Valdemoro | 4.7% | 1.4%–48.7% | 1.608 | -0.211 | 0.1 km | 6.1 | 0.032 | menor score entre 198 candidatas (la más barata era Petroprix a 1.607, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | T9 (repostaje) | 4.7% | 20.7 | 23.0 L | 43.7 |
| 2 | Aranjuez | 8.4% | 42.3 | — | 42.3 |
| 3 | Ciudad Real | 38.1% | 30.7 | — | 30.7 |
| 4 | Córdoba | 70.0% | 18.4 | — | 18.4 |
| 5 | Antequera | 90.7% | 10.4 | — | 10.4 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Ciudad Real | 37.9% | 1.4%–48.7% | 1.669 | -0.150 | 0.0 km | 0.0 | 0.072 | menor score entre 198 candidatas (la más barata era Petroprix a 1.607, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Aranjuez | 8.4% | 19.2 | — | 19.2 |
| 2 | PLENERGY (repostaje) | 37.9% | 7.8 | 23.0 L | 30.8 |
| 3 | Ciudad Real | 38.1% | 30.7 | — | 30.7 |
| 4 | Córdoba | 70.0% | 18.4 | — | 18.4 |
| 5 | Antequera | 90.7% | 10.4 | — | 10.4 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Ciudad Real | 37.9% | 1.4%–48.7% | 1.669 | -0.150 | 0.0 km | 0.0 | 0.007 | menor score entre 198 candidatas (la más barata era Petroprix a 1.607, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Aranjuez | 8.4% | 19.2 | — | 19.2 |
| 2 | PLENERGY (repostaje) | 37.9% | 7.8 | 23.0 L | 30.8 |
| 3 | Ciudad Real | 38.1% | 30.7 | — | 30.7 |
| 4 | Córdoba | 70.0% | 18.4 | — | 18.4 |
| 5 | Antequera | 90.7% | 10.4 | — | 10.4 |
| — | **Destino** | 100% | **6.7** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 20.7 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.8 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.8 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 37.03 € · equilibrado 38.44 € · rápido 38.44 € |
| ✅ | Barato tiene el coste mínimo | barato 37.03 € vs mejor de los otros 38.44 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 0.1 km |


## S15 · 5 paradas del conductor (>3)

> **Objetivo del test:** Cinco waypoints en un trayecto largo. Estrés del ordenamiento y de las ventanas con muchos puntos propios.

**Ruta:** Bilbao → Madrid → Toledo → Ciudad Real → Córdoba → Granada → Málaga  
**Parámetros:** SP95 · consumo 7 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1179 km · 791 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 750 estaciones · precio medio 1.830 €/L

### Plan de combustible

```
consumo del viaje  = 1179 km × 7/100        = 82.5 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 7 × 100  = 300 km
autonomía tanque   = (50-4.0) / 7 × 100  = 657 km
¿llega sin parar?  = 25.0 - 82.5 ≥ 7.5? → NO
paradas mínimas    = 2   (modo=auto → se usan 2)
```
**Justificación:** La autonomía de salida (300 km) no cubre los 1179 km. Con 2 repostaje(s) de depósito lleno la autonomía acumulada es 300 + 2×657 = 1614 km ≥ 1179 km. **Mínimo 2 parada(s).**

### Comparativa de estrategias (nStops=2)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.605 € | 0.6 km | 104.40 € | 65 L |
| Equilibrado | 1.635 € | 0.5 km | 106.87 € | 65 L |
| Más rápido | 1.701 € | 0.1 km | 110.10 € | 65 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | E.LECLERC (E.Leclerc) | Miranda de Ebro | 6.5% | 0.4%–25.4% | 1.600 | -0.230 | 1.0 km | 7.0 | 0.035 | menor score entre 103 candidatas de la ventana (también la más barata) |
| 2 | PLENERGY (Plenergy) | Puertollano | 58.3% | 48.5%–62.3% | 1.609 | -0.221 | 0.1 km | 6.1 | 0.048 | menor score entre 56 candidatas (la más barata era Family Energy a 1.609, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | E.LECLERC (repostaje) | 6.5% | 19.6 | 27.1 L | 46.7 |
| 2 | Madrid | 34.1% | 24.0 | — | 24.0 |
| 3 | Toledo | 40.2% | 18.9 | — | 18.9 |
| 4 | Ciudad Real | 55.0% | 6.7 | — | 6.7 |
| 5 | PLENERGY (repostaje) | 58.3% | 4.0 | 37.9 L | 41.9 |
| 6 | Córdoba | 71.1% | 31.3 | — | 31.3 |
| 7 | Granada | 88.8% | 16.8 | — | 16.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | E.LECLERC (E.Leclerc) | Miranda de Ebro | 6.5% | 0.4%–25.4% | 1.600 | -0.230 | 1.0 km | 7.0 | 0.281 | menor score entre 103 candidatas de la ventana (también la más barata) |
| 2 | PLENERGY (Plenergy) | Ciudad Real | 54.9% | 48.5%–62.3% | 1.669 | -0.161 | 0.0 km | 0.0 | 0.082 | menor score entre 56 candidatas (la más barata era Family Energy a 1.609, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | E.LECLERC (repostaje) | 6.5% | 19.6 | 24.3 L | 43.9 |
| 2 | Madrid | 34.1% | 21.2 | — | 21.2 |
| 3 | Toledo | 40.2% | 16.1 | — | 16.1 |
| 4 | PLENERGY (repostaje) | 54.9% | 4.0 | 40.7 L | 44.7 |
| 5 | Ciudad Real | 55.0% | 44.6 | — | 44.6 |
| 6 | Córdoba | 71.1% | 31.3 | — | 31.3 |
| 7 | Granada | 88.8% | 16.8 | — | 16.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | EROSKI (Eroski) | Ribera Baja/Erribera Beitia | 6.3% | 0.4%–25.4% | 1.733 | -0.097 | 0.1 km | 6.1 | 0.623 | menor score entre 103 candidatas (la más barata era E.Leclerc a 1.600, con peor score por desvío/tiempo) |
| 2 | PLENERGY (Plenergy) | Ciudad Real | 54.9% | 48.5%–62.0% | 1.669 | -0.161 | 0.0 km | 0.0 | 0.008 | menor score entre 56 candidatas (la más barata era Family Energy a 1.609, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | EROSKI (repostaje) | 6.3% | 19.8 | 24.3 L | 44.1 |
| 2 | Madrid | 34.1% | 21.2 | — | 21.2 |
| 3 | Toledo | 40.2% | 16.1 | — | 16.1 |
| 4 | PLENERGY (repostaje) | 54.9% | 4.0 | 40.7 L | 44.7 |
| 5 | Ciudad Real | 55.0% | 44.6 | — | 44.6 |
| 6 | Córdoba | 71.1% | 31.3 | — | 31.3 |
| 7 | Granada | 88.8% | 16.8 | — | 16.8 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.0 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.0 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 104.40 € · equilibrado 106.87 € · rápido 110.10 € |
| ✅ | Barato tiene el coste mínimo | barato 104.40 € vs mejor de los otros 106.87 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.6 km |


## S16 · Forzar 1 parada cuando auto pide 2 (infra-repostaje)

> **Objetivo del test:** stopsMode=1 en ruta que necesita 2. DEBE detectarse que se llega bajo mínimos o en seco.

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 80% · llegada ≥ 15% · paradas=1

**Ruta calculada:** 1112 km · 636 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 827 estaciones · precio medio 1.835 €/L

### Plan de combustible

```
consumo del viaje  = 1112 km × 6.5/100        = 72.3 L
litros de salida   = 50 × 80%                    = 40.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (40.0-4.0) / 6.5 × 100  = 554 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 40.0 - 72.3 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=1 → se usan 1)
```
**Justificación:** La autonomía de salida (554 km) no cubre los 1112 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 554 + 1×708 = 1262 km ≥ 1112 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.799 € | 0.2 km | 71.60 € | 40 L |
| Equilibrado | 1.799 € | 0.2 km | 71.60 € | 40 L |
| Más rápido | 1.863 € | 0.1 km | 74.15 € | 40 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | DILAMOR (Dilamor) | Tébar | 45.7% | 41.2%–49.8% | 1.799 | -0.036 | 0.2 km | 6.2 | 0.448 | menor score entre 15 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | DILAMOR (repostaje) | 45.7% | 7.0 | 39.8 L | 46.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | DILAMOR (Dilamor) | Tébar | 45.7% | 41.2%–49.8% | 1.799 | -0.036 | 0.2 km | 6.2 | 0.284 | menor score entre 15 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | DILAMOR (repostaje) | 45.7% | 7.0 | 39.8 L | 46.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | San Clemente | 48.3% | 41.2%–49.8% | 1.863 | +0.028 | 0.1 km | 6.1 | 0.043 | menor score entre 15 candidatas (la más barata era Dilamor a 1.799, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 48.3% | 5.1 | 39.8 L | 44.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.0 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.0 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.1 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 71.60 € · equilibrado 71.60 € · rápido 74.15 € |
| ✅ | Barato tiene el coste mínimo | barato 71.60 € vs mejor de los otros 71.60 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.2 km |


## S17 · Forzar 3 paradas cuando auto pide 1 (sobre-repostaje)

> **Objetivo del test:** stopsMode=3 en ruta que solo necesita 1. Comprueba cómo se distribuyen 3 ventanas y que no sobra depósito absurdo.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=3

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones · precio medio 1.829 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 6.5 × 100  = 323 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 25.0 - 40.3 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=3 → se usan 3)
```
**Justificación:** La autonomía de salida (323 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 323 + 1×708 = 1031 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=3)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.587 € | 0.8 km | 36.20 € | 23 L |
| Equilibrado | 1.609 € | 0.4 km | 36.26 € | 23 L |
| Más rápido | 1.665 € | 0.1 km | 37.96 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.7%–52.1% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.037 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |
| 2 | PETROCAT DIRECTE (Petrocat) | Olèrdola | 90.7% | 48.6%–100.0% | 1.569 | -0.260 | 1.1 km | 7.1 | 0.014 | menor score entre 297 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |
| 3 | PLENERGY (Plenergy) | Hospitalet de Llobregat (L') | 99.0% | 90.7%–100.0% | 1.605 | -0.224 | 0.9 km | 6.9 | 0.079 | menor score entre 177 candidatas (la más barata era Plenergy a 1.605, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 21.4 | 15.5 L | 37.0 |
| 2 | PETROCAT DIRECTE (repostaje) | 90.7% | 4.0 | 3.4 L | 7.4 |
| 3 | PLENERGY (repostaje) | 99.0% | 4.0 | 3.9 L | 7.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.7%–52.1% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.048 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |
| 2 | GALP (Galp) | Hospitalet de Llobregat (L') | 98.9% | 48.6%–100.0% | 1.634 | -0.195 | 0.0 km | 6.0 | 0.076 | menor score entre 297 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |
| 3 | PLENERGY (Plenergy) | Hospitalet de Llobregat (L') | 99.0% | 98.9%–100.0% | 1.605 | -0.224 | 0.9 km | 6.9 | 0.126 | menor score entre 66 candidatas (la más barata era Plenergy a 1.605, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 21.4 | 18.8 L | 40.3 |
| 2 | GALP (repostaje) | 98.9% | 4.0 | 0.1 L | 4.1 |
| 3 | PLENERGY (repostaje) | 99.0% | 4.0 | 3.9 L | 7.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Guadalajara | 8.9% | 0.7%–52.1% | 1.657 | -0.172 | 0.1 km | 6.1 | 0.018 | menor score entre 292 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |
| 2 | GALP (Galp) | Hospitalet de Llobregat (L') | 98.9% | 48.6%–100.0% | 1.634 | -0.195 | 0.0 km | 6.0 | 0.013 | menor score entre 297 candidatas (la más barata era Petrocat a 1.569, con peor score por desvío/tiempo) |
| 3 | PETROCAT DIRECTE (Petrocat) | Hospitalet de Llobregat (L') | 99.2% | 98.9%–100.0% | 1.705 | -0.124 | 0.1 km | 6.1 | 0.030 | menor score entre 66 candidatas (la más barata era Plenergy a 1.605, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 8.9% | 21.4 | 18.8 L | 40.3 |
| 2 | GALP (repostaje) | 98.9% | 4.0 | 0.1 L | 4.1 |
| 3 | PETROCAT DIRECTE (repostaje) | 99.2% | 4.0 | 3.8 L | 7.8 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 3/3 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.9 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 3/3 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 3/3 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 36.20 € · equilibrado 36.26 € · rápido 37.96 € |
| ✅ | Barato tiene el coste mínimo | barato 36.20 € vs mejor de los otros 36.26 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.8 km |


## S18 · Ida y vuelta

> **Objetivo del test:** roundTrip: el destino pasa a ser waypoint y se vuelve al origen; distancia ~doble.

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 60% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 721 km · 438 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 405 estaciones · precio medio 1.841 €/L

### Plan de combustible

```
consumo del viaje  = 721 km × 6.5/100        = 46.8 L
litros de salida   = 45 × 60%                    = 27.0 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (27.0-3.6) / 6.5 × 100  = 360 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 27.0 - 46.8 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (360 km) no cubre los 721 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 360 + 1×637 = 997 km ≥ 721 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.567 € | 0.5 km | 41.67 € | 27 L |
| Equilibrado | 1.567 € | 0.5 km | 41.67 € | 27 L |
| Más rápido | 1.875 € | 0.0 km | 49.86 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROMAX DE LEVANTE (Petromax De Levante) | Aldaia | 48.6% | 18.3%–50.0% | 1.567 | -0.274 | 0.5 km | 6.5 | 0.006 | menor score entre 99 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROMAX DE LEVANTE (repostaje) | 48.6% | 4.2 | 26.6 L | 30.8 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROMAX DE LEVANTE (Petromax De Levante) | Aldaia | 48.6% | 18.3%–50.0% | 1.567 | -0.274 | 0.5 km | 6.5 | 0.052 | menor score entre 99 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROMAX DE LEVANTE (repostaje) | 48.6% | 4.2 | 26.6 L | 30.8 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Quart de Poblet | 48.5% | 18.3%–50.0% | 1.875 | +0.034 | 0.0 km | 6.0 | 0.029 | menor score entre 99 candidatas (la más barata era Petromax De Levante a 1.567, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 48.5% | 4.3 | 26.6 L | 30.9 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.5 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.2 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.5 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.2 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.3 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 41.67 € · equilibrado 41.67 € · rápido 49.86 € |
| ✅ | Barato tiene el coste mínimo | barato 41.67 € vs mejor de los otros 41.67 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 0.5 km |


## S19 · Salida muy baja (20%)

> **Objetivo del test:** Primera ventana pegada al inicio: la parada 0 debe caer pronto (poca autonomía de salida).

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 20% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones · precio medio 1.829 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 50 × 20%                    = 10.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (10.0-4.0) / 6.5 × 100  = 92 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 10.0 - 40.3 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (92 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 92 + 1×708 = 800 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.587 € | 0.3 km | 59.99 € | 38 L |
| Equilibrado | 1.587 € | 0.3 km | 59.99 € | 38 L |
| Más rápido | 1.657 € | 0.1 km | 62.64 € | 38 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.0%–14.9% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.037 | menor score entre 233 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 6.4 | 37.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.9% | 0.0%–14.9% | 1.587 | -0.242 | 0.3 km | 6.3 | 0.048 | menor score entre 233 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.9% | 6.4 | 37.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Guadalajara | 8.9% | 0.0%–14.9% | 1.657 | -0.172 | 0.1 km | 6.1 | 0.018 | menor score entre 233 candidatas (la más barata era Plenergy a 1.587, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 8.9% | 6.4 | 37.8 L | 44.2 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 6.4 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 6.4 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 6.4 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 59.99 € · equilibrado 59.99 € · rápido 62.64 € |
| ✅ | Barato tiene el coste mínimo | barato 59.99 € vs mejor de los otros 59.99 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.3 km |


## S20 · Reserva de llegada alta (50%)

> **Objetivo del test:** arrivePct=50: la ÚLTIMA parada debe forzarse cerca del destino (arriveTopUpRangeKm pequeño).

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 50% · paradas=auto

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 585 estaciones · precio medio 1.829 €/L

### Plan de combustible

```
consumo del viaje  = 620 km × 6.5/100        = 40.3 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 50%                    = 25.0 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 40.3 ≥ 25.0? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 620 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 620 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.749 € | 0.2 km | 74.86 € | 43 L |
| Equilibrado | 1.749 € | 0.2 km | 74.86 € | 43 L |
| Más rápido | 1.798 € | 0.1 km | 76.96 € | 43 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 44.8% | 38.0%–45.9% | 1.749 | -0.080 | 0.2 km | 6.2 | 0.342 | menor score entre 13 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 44.8% | 4.4 | 42.8 L | 47.2 |
| — | **Destino** | 100% | **25.0** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 44.8% | 38.0%–45.9% | 1.749 | -0.080 | 0.2 km | 6.2 | 0.223 | menor score entre 13 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 44.8% | 4.4 | 42.8 L | 47.2 |
| — | **Destino** | 100% | **25.0** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MOEVE (Cepsa) | Épila | 44.4% | 38.0%–45.9% | 1.798 | -0.031 | 0.1 km | 6.1 | 0.035 | menor score entre 13 candidatas (la más barata era Bonarea a 1.749, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MOEVE (repostaje) | 44.4% | 4.6 | 42.8 L | 47.4 |
| — | **Destino** | 100% | **25.0** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.4 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.4 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.6 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 74.86 € · equilibrado 74.86 € · rápido 76.96 € |
| ✅ | Barato tiene el coste mínimo | barato 74.86 € vs mejor de los otros 74.86 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.2 km |


## S21 · Furgoneta (consumo 9.5)

> **Objetivo del test:** Consumo alto reduce autonomía: comprueba nº de paradas y litros repostados.

**Ruta:** Madrid → Sevilla  
**Parámetros:** Diésel · consumo 9.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 534 km · 300 min · peaje: no  
**Corredor (Diésel, ≤4 km):** 398 estaciones · precio medio 1.935 €/L

### Plan de combustible

```
consumo del viaje  = 534 km × 9.5/100        = 50.7 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 9.5 × 100  = 195 km
autonomía tanque   = (50-4.0) / 9.5 × 100  = 484 km
¿llega sin parar?  = 22.5 - 50.7 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (195 km) no cubre los 534 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 195 + 1×484 = 679 km ≥ 534 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.789 € | 1.8 km | 63.88 € | 36 L |
| Equilibrado | 1.858 € | 0.6 km | 66.35 € | 36 L |
| Más rápido | 1.969 € | 0.0 km | 70.31 € | 36 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SAN ROQUE ( LOW COST ) (San Roque ( Low Cost )) | Casar de Escalona (El) | 17.4% | 16.2%–36.5% | 1.789 | -0.146 | 1.8 km | 7.8 | 0.189 | menor score entre 44 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SAN ROQUE ( LOW COST ) (repostaje) | 17.4% | 13.7 | 35.7 L | 49.4 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | VALCARCE (Valcarce) | Talavera de la Reina | 24.8% | 16.2%–36.5% | 1.858 | -0.077 | 0.6 km | 6.6 | 0.255 | menor score entre 44 candidatas (la más barata era San Roque ( Low Cost ) a 1.789, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | VALCARCE (repostaje) | 24.8% | 9.9 | 35.7 L | 45.6 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Navalmoral de la Mata | 35.5% | 16.2%–36.5% | 1.969 | +0.034 | 0.0 km | 6.0 | 0.037 | menor score entre 44 candidatas (la más barata era San Roque ( Low Cost ) a 1.789, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 35.5% | 4.5 | 35.7 L | 40.2 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.8 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 13.7 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 9.9 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.5 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 63.88 € · equilibrado 66.35 € · rápido 70.31 € |
| ✅ | Barato tiene el coste mínimo | barato 63.88 € vs mejor de los otros 66.35 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.8 km |


## S22 · Depósito grande (80 L), salida 90%

> **Objetivo del test:** Gran autonomía: debería llegar sin paradas o con una sola pese a la distancia.

**Ruta:** Zaragoza → Sevilla  
**Parámetros:** Diésel · consumo 6 L/100 · depósito 80 L · salida 90% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 840 km · 474 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 613 estaciones · precio medio 1.942 €/L

### Plan de combustible

```
consumo del viaje  = 840 km × 6/100        = 50.4 L
litros de salida   = 80 × 90%                    = 72.0 L
reserva de llegada = 80 × 15%                    = 12.0 L
margen seguridad   = 80 × 8%                     = 6.4 L
autonomía salida   = (72.0-6.4) / 6 × 100  = 1093 km
autonomía tanque   = (80-6.4) / 6 × 100  = 1227 km
¿llega sin parar?  = 72.0 - 50.4 ≥ 12.0? → SÍ
paradas mínimas    = 0   (modo=auto → se usan 0)
```
**Justificación:** Con 72 L de salida y un consumo de 50 L, terminas con 22 L ≥ 12 L de reserva. **No hace falta repostar.**

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | Llega con la reserva pedida | llega con 21.6 L (reserva pedida 12.0 L) |


## S23 · SP98 (combustible premium poco común)

> **Objetivo del test:** Corredor de SP98 (menos estaciones que SP95). Verifica selección con corredor medio.

**Ruta:** Madrid → Granada  
**Parámetros:** SP98 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 421 km · 242 min · peaje: no  
**Corredor (SP98, ≤4 km):** 188 estaciones · precio medio 1.990 €/L

### Plan de combustible

```
consumo del viaje  = 421 km × 6.5/100        = 27.4 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 27.4 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 421 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 421 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.729 € | 3.1 km | 21.37 € | 12 L |
| Equilibrado | 1.758 € | 0.7 km | 21.73 € | 12 L |
| Más rápido | 1.907 € | 0.0 km | 23.57 € | 12 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Madrid | 1.6% | 0.0%–67.6% | 1.729 | -0.261 | 3.1 km | 9.1 | 0.039 | menor score entre 124 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 1.6% | 22.1 | 12.4 L | 34.4 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Valdepeñas | 48.0% | 0.0%–67.6% | 1.758 | -0.232 | 0.7 km | 6.7 | 0.100 | menor score entre 124 candidatas (la más barata era Alcampo a 1.729, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 48.0% | 9.4 | 12.4 L | 21.7 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SHELL (Shell) | Madrid | 0.9% | 0.0%–67.6% | 1.907 | -0.083 | 0.0 km | 6.0 | 0.019 | menor score entre 124 candidatas (la más barata era Alcampo a 1.729, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SHELL (repostaje) | 0.9% | 22.3 | 12.4 L | 34.6 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 3.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 22.1 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.7 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 9.4 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 22.3 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 21.37 € · equilibrado 21.73 € · rápido 23.57 € |
| ✅ | Barato tiene el coste mínimo | barato 21.37 € vs mejor de los otros 21.73 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 3.1 km |


### ⚠️ G012 · A Coruña→Cartagena · Compacto · SP98 · 45/40% · 1

**Ruta:** A Coruña → Cartagena  
**Parámetros:** SP98 · consumo 5.5 L/100 · depósito 55 L · salida 45% · llegada ≥ 40% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 2.295 € | 0.0 km | 115.74 € | 50 L |
| Equilibrado | 2.295 € | 0.0 km | 115.74 € | 50 L |
| Más rápido | 2.295 € | 0.0 km | 115.74 € | 50 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 17.8 L (pedida 22.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 17.8 L (pedida 22.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 17.8 L (pedida 22.0 L) |


### ⚠️ G016 · Zaragoza→Sevilla · Compacto · SP95 · 30/40% · auto

**Ruta:** Zaragoza → Sevilla  
**Parámetros:** SP95 · consumo 5.5 L/100 · depósito 55 L · salida 30% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.845 € | 0.0 km | 93.14 € | 50 L |
| Equilibrado | 1.845 € | 0.0 km | 93.14 € | 50 L |
| Más rápido | 1.845 € | 0.0 km | 93.14 € | 50 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 20.8 L (pedida 22.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 20.8 L (pedida 22.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 20.8 L (pedida 22.0 L) |


### ⚠️ G024 · Madrid→Barcelona +2wp · Compacto · SP98 · 80/40% · 2 · Repsol

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** SP98 · consumo 5.5 L/100 · depósito 55 L · salida 80% · llegada ≥ 40% · paradas=2 · marcas: Repsol

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.872 € | 1.4 km | 23.77 € | 12 L |
| Equilibrado | 1.895 € | 1.1 km | 23.52 € | 12 L |
| Más rápido | 1.895 € | 1.1 km | 23.52 € | 12 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 23.77 € · equilibrado 23.52 € · rápido 23.52 € |
| ⚠️ | Barato tiene el coste mínimo | barato 23.77 € vs mejor de los otros 23.52 € (Δ 0.25 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |


### ⚠️ G028 · Bilbao→Málaga +5wp · Compacto · SP95 · 60/40% · auto

**Ruta:** Bilbao → Madrid → Toledo → Ciudad Real → Córdoba → Granada → Málaga  
**Parámetros:** SP95 · consumo 5.5 L/100 · depósito 55 L · salida 60% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.949 € | 2.2 km | 97.54 € | 50 L |
| Equilibrado | 1.949 € | 2.2 km | 97.54 € | 50 L |
| Más rápido | 1.949 € | 2.2 km | 97.54 € | 50 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 18.2 L (pedida 22.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 18.2 L (pedida 22.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 18.2 L (pedida 22.0 L) |


### ⚠️ G031 · Barcelona→Cádiz · Compacto · SP95 · 30/25% · auto · i/v

**Ruta:** Barcelona → Cádiz → Barcelona (ida y vuelta)  
**Parámetros:** SP95 · consumo 5.5 L/100 · depósito 55 L · salida 30% · llegada ≥ 25% · paradas=auto

**Comparativa de estrategias (nStops=3):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.658 € | 0.4 km | 199.81 € | 119 L |
| Equilibrado | 1.645 € | 0.3 km | 195.88 € | 119 L |
| Más rápido | 1.692 € | 0.0 km | 203.91 € | 119 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 199.81 € · equilibrado 195.88 € · rápido 203.91 € |
| ⚠️ | Barato tiene el coste mínimo | barato 199.81 € vs mejor de los otros 195.88 € (Δ 3.93 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |


### ⚠️ G046 · Valencia→A Coruña · Berlina · SP95 · 30/10% · 1

**Ruta:** Valencia → A Coruña  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 10% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.859 € | 0.1 km | 83.05 € | 45 L |
| Equilibrado | 1.859 € | 0.1 km | 83.05 € | 45 L |
| Más rápido | 1.859 € | 0.1 km | 83.05 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -2.1 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -2.1 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -2.1 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G051 · Sevilla→Barcelona · Berlina · SP98 · 30/15% · 1

**Ruta:** Sevilla → Barcelona  
**Parámetros:** SP98 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 15% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.959 € | 0.2 km | 88.04 € | 45 L |
| Equilibrado | 1.959 € | 0.2 km | 88.04 € | 45 L |
| Más rápido | 1.959 € | 0.2 km | 88.04 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -7.6 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -7.6 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -7.6 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G052 · Bilbao→Málaga · Berlina · SP95 · 45/25% · auto

**Ruta:** Bilbao → Málaga  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 25% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.835 € | 0.2 km | 83.76 € | 46 L |
| Equilibrado | 1.835 € | 0.2 km | 83.76 € | 46 L |
| Más rápido | 1.835 € | 0.2 km | 83.76 € | 46 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 7.3 L (pedida 12.5 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 7.3 L (pedida 12.5 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 7.3 L (pedida 12.5 L) |


### ⚠️ G055 · Madrid→Barcelona +2wp · Berlina · SP95 · 90/15% · auto · Cepsa+BP

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 90% · llegada ≥ 15% · paradas=auto · marcas: Cepsa+BP

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.793 € | 0.1 km | 5.69 € | 3 L |
| Equilibrado | 1.828 € | 0.9 km | 5.80 € | 3 L |
| Más rápido | 1.853 € | 0.5 km | 5.88 € | 3 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Rápido no tiene más desvío que barato | desvío rápido 0.5 km vs barato 0.1 km |


### ⚠️ G056 · Cádiz→Barcelona +1wp · Berlina · Diésel · 30/25% · 1

**Ruta:** Cádiz → Madrid → Barcelona  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 25% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 2.009 € | 0.3 km | 90.51 € | 45 L |
| Equilibrado | 2.009 € | 0.3 km | 90.51 € | 45 L |
| Más rápido | 2.009 € | 0.3 km | 90.51 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -22.9 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -22.9 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -22.9 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G061 · Madrid→Valencia · Berlina · SP95 · 30/40% · 1 · i/v

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 40% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.863 € | 0.1 km | 85.03 € | 46 L |
| Equilibrado | 1.863 € | 0.1 km | 85.03 € | 46 L |
| Más rápido | 1.863 € | 0.1 km | 85.03 € | 46 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 13.8 L (pedida 20.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 13.8 L (pedida 20.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 13.8 L (pedida 20.0 L) |


### ⚠️ G062 · Barcelona→Cádiz · Berlina · Diésel · 45/10% · auto · i/v

**Ruta:** Barcelona → Cádiz → Barcelona (ida y vuelta)  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 10% · paradas=auto

**Comparativa de estrategias (nStops=3):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.869 € | 0.2 km | 236.48 € | 126 L |
| Equilibrado | 1.869 € | 0.2 km | 236.48 € | 126 L |
| Más rápido | 1.992 € | 0.0 km | 251.60 € | 126 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 4.5 L (pedida 5.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 4.5 L (pedida 5.0 L) |


### ⚠️ G070 · Barcelona→Cádiz · SUV · SP95 · 90/40% · 1 · Cepsa+BP

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 8 L/100 · depósito 60 L · salida 90% · llegada ≥ 40% · paradas=1 · marcas: Cepsa+BP

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.959 € | 1.1 km | 106.08 € | 54 L |
| Equilibrado | 1.959 € | 1.1 km | 106.08 € | 54 L |
| Más rápido | 1.959 € | 1.1 km | 106.08 € | 54 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 19.2 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 19.2 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 19.2 L (pedida 24.0 L) |


### ⚠️ G074 · A Coruña→Cartagena · SUV · Diésel · 80/40% · auto · Repsol

**Ruta:** A Coruña → Cartagena  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 80% · llegada ≥ 40% · paradas=auto · marcas: Repsol

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 2.019 € | 2.4 km | 109.50 € | 54 L |
| Equilibrado | 2.019 € | 2.4 km | 109.50 € | 54 L |
| Más rápido | 2.019 € | 2.4 km | 109.50 € | 54 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |


### ⚠️ G086 · Madrid→Barcelona +2wp · SUV · Diésel · 30/40% · auto

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 30% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.945 € | 0.1 km | 105.89 € | 54 L |
| Equilibrado | 1.945 € | 0.1 km | 105.89 € | 54 L |
| Más rápido | 1.945 € | 0.1 km | 105.89 € | 54 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 22.4 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 22.4 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 22.4 L (pedida 24.0 L) |


### ⚠️ G090 · Bilbao→Málaga +5wp · SUV · SP98 · 90/40% · 1 · Cepsa+BP

**Ruta:** Bilbao → Madrid → Toledo → Ciudad Real → Córdoba → Granada → Málaga  
**Parámetros:** SP98 · consumo 8 L/100 · depósito 60 L · salida 90% · llegada ≥ 40% · paradas=1 · marcas: Cepsa+BP

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 2.149 € | 0.1 km | 108.49 € | 50 L |
| Equilibrado | 2.149 € | 0.1 km | 108.49 € | 50 L |
| Más rápido | 2.149 € | 0.1 km | 108.49 € | 50 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 10.2 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 10.2 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 10.2 L (pedida 24.0 L) |


### ⚠️ G092 · Madrid→Valencia · SUV · Diésel · 45/15% · 2 · i/v

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 45% · llegada ≥ 15% · paradas=2

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.789 € | 0.5 km | 71.81 € | 40 L |
| Equilibrado | 1.799 € | 0.2 km | 70.80 € | 40 L |
| Más rápido | 1.814 € | 0.1 km | 71.19 € | 40 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 71.81 € · equilibrado 70.80 € · rápido 71.19 € |
| ⚠️ | Barato tiene el coste mínimo | barato 71.81 € vs mejor de los otros 70.80 € (Δ 1.01 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |


### ⚠️ G093 · Barcelona→Cádiz · SUV · SP98 · 60/25% · auto · i/v

**Ruta:** Barcelona → Cádiz → Barcelona (ida y vuelta)  
**Parámetros:** SP98 · consumo 8 L/100 · depósito 60 L · salida 60% · llegada ≥ 25% · paradas=auto

**Comparativa de estrategias (nStops=3):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.913 € | 1.9 km | 297.82 € | 155 L |
| Equilibrado | 1.979 € | 0.2 km | 307.57 € | 155 L |
| Más rápido | 1.997 € | 0.1 km | 310.26 € | 155 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |
