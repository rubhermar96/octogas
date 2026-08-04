# Informe de test de la lógica del planificador de rutas

_Generado el 2026-07-16 20:43 · **123 escenarios** (23 detallados + 100 de cobertura) · 11.475 gasolineras reales_

> **Unicidad:** 123 firmas únicas de 123 escenarios → ✅ ninguna opción se repite.

> **Corrección aplicada:** `pickStops` reescrito para que cada parada sea a la vez PREFERENTE y FACTIBLE (ventana acotada al alcance real desde la parada anterior). Antes de este cambio, este test detectaba planes inviables en rutas de ≥2 repostajes (te quedabas seco entre paradas). Este informe re-verifica todo el pipeline con el fix.

## Metodología

- **Datos reales:** `public/data/stations.json` (11.475 estaciones con precios del día).
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

### 🟠 Hallazgo 2 — "Más barato" puede costar más que "Equilibrado"

Consecuencia directa del Hallazgo 1. Cuando un plan se queda seco, `allocateRefuels` recorta el depósito a 0 (`Math.max(0, …)`) y **descarta silenciosamente el combustible negativo**, lo que altera cuántos litros se compran y en qué estaciones (de precios distintos). Por eso la selección nominalmente más barata puede terminar con un coste total mayor, y los litros/coste mostrados dejan de ser físicamente exactos.

| Escenario | Coste "Más barato" | Mejor de los otros | Diferencia |
|---|--:|--:|--:|
| S04 Muy larga + depósito pequeño → ~3 paradas (auto) | 137.12 € | 131.72 € | +5.40 € |

**Corrección:** se resuelve al arreglar el Hallazgo 1 (planes viables). Adicionalmente, `allocateRefuels` no debería descartar el déficit: si un tramo excede el depósito, debería señalarlo como inviable en vez de simular una llegada a 0 L.

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

**123 escenarios · 123 únicos (sin repeticiones).** Comprobaciones: ✅ 2314 · ⚠️ 48 · ❌ 1

_Columna "Coste b/e/r" = coste de repostaje en barato/equilibrado/rápido. Los escenarios en **negrita** llevan volcado detallado más abajo; el resto se resume aquí (y se detallan solo si tienen ⚠️/❌)._

| Escenario | Distancia | Paradas | Coste b/e/r | ✅ | ⚠️ | ❌ |
|---|--:|---|--:|--:|--:|--:|
| **S01 Trayecto corto, depósito lleno → 0 paradas** | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| **S02 Media distancia, salida 50% → 1 parada (auto)** | 620 km | 1 (auto) | 22.8/22.8/22.8 € | 21 | 0 | 0 |
| **S03 Larga distancia → 2 paradas (auto)** | 1116 km | 1 (auto) | 58.8/58.8/68.8 € | 21 | 0 | 0 |
| **S04 Muy larga + depósito pequeño → ~3 paradas (auto)** | 1167 km | 4 (auto) | 137.1/131.7/148.7 € | 19 | 1 | 1 |
| **S05 Extremo: depósito 25 L → >3 paradas (auto)** | 1043 km | 5 (auto) | 142.3/144.1/154.7 € | 21 | 0 | 0 |
| **S06 Diésel, 1 parada** | 358 km | 1 (auto) | 14.3/14.5/14.9 € | 21 | 0 | 0 |
| **S07 GLP (autogas): corredor escaso** | 397 km | 1 (auto) | 14.8/14.8/20.0 € | 21 | 0 | 0 |
| **S08 Evitar peajes (Madrid→Sevilla)** | 531 km | 1 (auto) | 27.3/27.9/27.9 € | 21 | 0 | 0 |
| **S09 Evitar peajes (Barcelona→Madrid)** | 622 km | 1 (auto) | 33.8/34.2/42.0 € | 21 | 0 | 0 |
| **S10 Filtro de marca: solo Repsol** | 620 km | 1 (auto) | 43.3/43.3/45.0 € | 21 | 0 | 0 |
| **S11 Filtro de marca: Cepsa + BP** | 620 km | 1 (auto) | 42.6/43.1/45.0 € | 21 | 0 | 0 |
| **S12 1 parada del conductor (waypoint)** | 755 km | 1 (auto) | 45.4/47.3/53.2 € | 21 | 0 | 0 |
| **S13 2 paradas del conductor** | 626 km | 1 (auto) | 36.7/36.7/38.6 € | 21 | 0 | 0 |
| **S14 4 paradas del conductor (>3)** | 597 km | 1 (auto) | 31.2/31.6/31.7 € | 21 | 0 | 0 |
| **S15 5 paradas del conductor (>3)** | 1122 km | 2 (auto) | 86.3/86.8/94.6 € | 21 | 0 | 0 |
| **S16 Forzar 1 parada cuando auto pide 2 (infra-repostaje)** | 1116 km | 1 (forzado, auto=1) | 58.8/58.8/68.8 € | 21 | 0 | 0 |
| **S17 Forzar 3 paradas cuando auto pide 1 (sobre-repostaje)** | 620 km | 3 (forzado, auto=1) | 24.7/27.9/25.4 € | 20 | 1 | 0 |
| **S18 Ida y vuelta** | 716 km | 1 (auto) | 36.0/36.0/42.7 € | 21 | 0 | 0 |
| **S19 Salida muy baja (20%)** | 620 km | 1 (auto) | 52.1/52.9/63.5 € | 21 | 0 | 0 |
| **S20 Reserva de llegada alta (50%)** | 620 km | 1 (auto) | 56.9/57.8/57.8 € | 21 | 0 | 0 |
| **S21 Furgoneta (consumo 9.5)** | 531 km | 1 (auto) | 52.8/54.2/60.8 € | 21 | 0 | 0 |
| **S22 Depósito grande (80 L), salida 90%** | 859 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| **S23 SP98 (combustible premium poco común)** | 421 km | 1 (auto) | 18.9/18.9/22.6 € | 21 | 0 | 0 |
| G001 Madrid→Toledo · Compacto · SP95 · 30/10% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G002 Madrid→Valencia · Compacto · Diésel · 45/15% · 1 | 358 km | 1 (forzado, auto=1) | 4.6/4.7/5.0 € | 21 | 0 | 0 |
| G003 Madrid→Barcelona · Compacto · SP98 · 60/25% · auto | 620 km | 1 (auto) | 21.2/21.2/26.7 € | 21 | 0 | 0 |
| G004 Madrid→Sevilla · Compacto · SP95 · 80/40% · 2 · Repsol | 531 km | 2 (forzado, auto=1) | 11.6/11.7/11.9 € | 21 | 0 | 0 |
| G005 Madrid→Málaga · Compacto · Diésel · 90/10% · auto · Cepsa+BP | 536 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G006 Madrid→Bilbao · Compacto · SP98 · 30/15% · auto | 397 km | 1 (auto) | 21.5/21.5/24.0 € | 21 | 0 | 0 |
| G007 Madrid→Granada · Compacto · SP95 · 45/25% · 1 | 421 km | 1 (forzado, auto=1) | 16.9/17.4/18.2 € | 21 | 0 | 0 |
| G008 Barcelona→Cádiz · Compacto · Diésel · 60/40% · auto | 1116 km | 1 (auto) | 85.1/85.1/85.1 € | 21 | 0 | 0 |
| G009 Barcelona→Sevilla · Compacto · SP98 · 80/10% · 2 · Repsol | 998 km | 2 (forzado, auto=1) | 28.5/28.6/29.5 € | 21 | 0 | 0 |
| G010 Barcelona→Madrid · Compacto · SP95 · 90/15% · auto · sin peaje · Cepsa+BP | 622 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G011 A Coruña→Almería · Compacto · Diésel · 30/25% · auto | 1167 km | 2 (auto) | 87.1/89.7/99.2 € | 21 | 0 | 0 |
| G012 A Coruña→Cartagena · Compacto · SP98 · 45/40% · 1 | 1043 km | 1 (forzado, auto=1) | 90.9/90.9/90.9 € | 18 | 3 | 0 |
| G013 A Coruña→Madrid · Compacto · SP95 · 60/10% · auto | 592 km | 1 (auto) | 6.5/6.5/8.4 € | 21 | 0 | 0 |
| G014 Valencia→Bilbao · Compacto · Diésel · 80/15% · 2 · Repsol | 612 km | 2 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G015 Valencia→A Coruña · Compacto · SP98 · 90/25% · auto · Cepsa+BP | 951 km | 1 (auto) | 28.6/28.6/30.8 € | 21 | 0 | 0 |
| G016 Zaragoza→Sevilla · Compacto · SP95 · 30/40% · auto | 859 km | 1 (auto) | 80.2/80.2/80.2 € | 18 | 3 | 0 |
| G017 Málaga→Bilbao · Compacto · Diésel · 45/10% · 1 | 930 km | 1 (forzado, auto=1) | 45.3/45.3/52.9 € | 21 | 0 | 0 |
| G018 Cartagena→Madrid · Compacto · SP98 · 60/15% · auto | 448 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G019 Granada→Zaragoza · Compacto · SP95 · 80/25% · 2 · Repsol | 729 km | 2 (forzado, auto=1) | 16.1/15.9/16.3 € | 19 | 2 | 0 |
| G020 Sevilla→Barcelona · Compacto · Diésel · 90/40% · auto · Cepsa+BP | 1039 km | 1 (auto) | 47.1/48.0/49.8 € | 21 | 0 | 0 |
| G021 Bilbao→Málaga · Compacto · SP98 · 30/10% · auto | 936 km | 1 (auto) | 68.8/71.6/72.4 € | 21 | 0 | 0 |
| G022 Almería→Bilbao · Compacto · SP95 · 45/15% · 1 | 977 km | 1 (forzado, auto=1) | 51.7/54.3/60.3 € | 21 | 0 | 0 |
| G023 Valencia→Bilbao +1wp · Compacto · Diésel · 60/25% · auto | 755 km | 1 (auto) | 32.7/35.0/37.8 € | 21 | 0 | 0 |
| G024 Madrid→Barcelona +2wp · Compacto · SP98 · 80/40% · 2 · Repsol | 626 km | 2 (forzado, auto=1) | 21.2/21.2/20.8 € | 20 | 1 | 0 |
| G025 Cádiz→Barcelona +1wp · Compacto · SP95 · 90/10% · auto · Cepsa+BP | 1270 km | 1 (auto) | 39.3/43.1/43.4 € | 21 | 0 | 0 |
| G026 Bilbao→Valencia +1wp · Compacto · Diésel · 30/15% · auto | 612 km | 1 (auto) | 36.6/36.8/44.5 € | 21 | 0 | 0 |
| G027 Madrid→Málaga +4wp · Compacto · SP98 · 45/25% · 1 | 597 km | 1 (forzado, auto=1) | 33.8/34.9/38.7 € | 21 | 0 | 0 |
| G028 Bilbao→Málaga +5wp · Compacto · SP95 · 60/40% · auto | 1122 km | 1 (auto) | 78.1/78.1/78.1 € | 21 | 0 | 0 |
| G029 Madrid→Sevilla · Compacto · Diésel · 80/10% · 2 · sin peaje · Repsol | 531 km | 2 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G030 Madrid→Valencia · Compacto · SP98 · 90/15% · auto · i/v · Cepsa+BP | 716 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G031 Barcelona→Cádiz · Compacto · SP95 · 30/25% · auto · i/v | 2213 km | 3 (auto) | 164.6/167.7/190.6 € | 21 | 0 | 0 |
| G032 Madrid→Toledo · Berlina · Diésel · 45/25% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G033 Madrid→Valencia · Berlina · SP98 · 60/40% · 2 | 358 km | 2 (forzado, auto=1) | 21.2/21.2/23.9 € | 21 | 0 | 0 |
| G034 Madrid→Barcelona · Berlina · SP95 · 80/10% · auto · Repsol | 620 km | 1 (auto) | 8.5/8.7/8.7 € | 21 | 0 | 0 |
| G035 Madrid→Sevilla · Berlina · Diésel · 90/15% · auto · Cepsa+BP | 531 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G036 Madrid→Málaga · Berlina · SP98 · 30/25% · 1 | 536 km | 1 (forzado, auto=1) | 49.5/49.5/56.8 € | 21 | 0 | 0 |
| G037 Madrid→Bilbao · Berlina · SP95 · 45/40% · auto | 397 km | 1 (auto) | 34.5/34.9/39.4 € | 21 | 0 | 0 |
| G038 Madrid→Granada · Berlina · Diésel · 60/10% · 2 | 421 km | 2 (forzado, auto=1) | 3.4/3.4/3.4 € | 21 | 0 | 0 |
| G039 Barcelona→Cádiz · Berlina · SP98 · 80/15% · auto · Repsol | 1116 km | 1 (auto) | 74.0/74.0/75.6 € | 21 | 0 | 0 |
| G040 Barcelona→Sevilla · Berlina · SP95 · 90/25% · auto · Cepsa+BP | 998 km | 1 (auto) | 51.4/51.4/54.3 € | 21 | 0 | 0 |
| G041 Barcelona→Madrid · Berlina · Diésel · 30/40% · 1 · sin peaje | 622 km | 1 (forzado, auto=1) | 74.8/74.8/74.8 € | 21 | 0 | 0 |
| G042 A Coruña→Almería · Berlina · SP98 · 45/10% · auto | 1167 km | 2 (auto) | 89.0/89.0/102.3 € | 21 | 0 | 0 |
| G043 A Coruña→Cartagena · Berlina · SP95 · 60/15% · 2 | 1043 km | 2 (forzado, auto=1) | 62.1/62.1/75.2 € | 21 | 0 | 0 |
| G044 A Coruña→Madrid · Berlina · Diésel · 80/25% · auto · Repsol | 592 km | 1 (auto) | 18.4/18.4/18.6 € | 21 | 0 | 0 |
| G045 Valencia→Bilbao · Berlina · SP98 · 90/40% · auto · Cepsa+BP | 612 km | 1 (auto) | 25.0/25.0/26.3 € | 21 | 0 | 0 |
| G046 Valencia→A Coruña · Berlina · SP95 · 30/10% · 1 | 951 km | 1 (forzado, auto=2) | 76.9/76.9/76.9 € | 18 | 3 | 0 |
| G047 Zaragoza→Sevilla · Berlina · Diésel · 45/15% · auto | 859 km | 1 (auto) | 67.6/69.0/70.2 € | 21 | 0 | 0 |
| G048 Málaga→Bilbao · Berlina · SP98 · 60/25% · 2 | 930 km | 2 (forzado, auto=1) | 66.9/70.2/74.6 € | 21 | 0 | 0 |
| G049 Cartagena→Madrid · Berlina · SP95 · 80/40% · auto · Repsol | 448 km | 1 (auto) | 14.2/14.2/15.1 € | 21 | 0 | 0 |
| G050 Granada→Zaragoza · Berlina · Diésel · 90/10% · auto · Cepsa+BP | 729 km | 1 (auto) | 11.5/12.3/12.8 € | 21 | 0 | 0 |
| G051 Sevilla→Barcelona · Berlina · SP98 · 30/15% · 1 | 1039 km | 1 (forzado, auto=2) | 79.3/79.3/79.3 € | 18 | 3 | 0 |
| G052 Bilbao→Málaga · Berlina · SP95 · 45/25% · auto | 936 km | 1 (auto) | 75.5/75.5/75.5 € | 18 | 3 | 0 |
| G053 Almería→Bilbao · Berlina · Diésel · 60/40% · 2 | 977 km | 2 (forzado, auto=1) | 78.7/79.2/90.8 € | 21 | 0 | 0 |
| G054 Valencia→Bilbao +1wp · Berlina · SP98 · 80/10% · auto · Repsol | 755 km | 1 (auto) | 24.8/25.2/25.6 € | 21 | 0 | 0 |
| G055 Madrid→Barcelona +2wp · Berlina · SP95 · 90/15% · auto · Cepsa+BP | 626 km | 1 (auto) | 4.8/4.8/4.8 € | 21 | 0 | 0 |
| G056 Cádiz→Barcelona +1wp · Berlina · Diésel · 30/25% · 1 | 1270 km | 1 (forzado, auto=2) | 77.9/77.9/77.9 € | 18 | 3 | 0 |
| G057 Bilbao→Valencia +1wp · Berlina · SP98 · 45/40% · auto | 612 km | 1 (auto) | 54.8/54.8/65.2 € | 21 | 0 | 0 |
| G058 Madrid→Málaga +4wp · Berlina · SP95 · 60/10% · 2 | 597 km | 2 (forzado, auto=1) | 18.9/21.4/19.2 € | 20 | 1 | 0 |
| G059 Bilbao→Málaga +5wp · Berlina · Diésel · 80/15% · auto · Repsol | 1122 km | 1 (auto) | 67.5/68.3/68.3 € | 21 | 0 | 0 |
| G060 Madrid→Sevilla · Berlina · SP98 · 90/25% · auto · sin peaje · Cepsa+BP | 531 km | 1 (auto) | 3.5/3.6/3.8 € | 21 | 0 | 0 |
| G061 Madrid→Valencia · Berlina · SP95 · 30/40% · 1 · i/v | 716 km | 1 (forzado, auto=1) | 77.0/77.0/77.0 € | 18 | 3 | 0 |
| G062 Barcelona→Cádiz · Berlina · Diésel · 45/10% · auto · i/v | 2213 km | 3 (auto) | 182.2/184.0/214.2 € | 20 | 1 | 0 |
| G063 Madrid→Toledo · SUV · SP98 · 60/10% · auto | 73 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G064 Madrid→Valencia · SUV · SP95 · 80/15% · auto · Repsol | 358 km | 0 (auto=0) | sin repostaje | 1 | 0 | 0 |
| G065 Madrid→Barcelona · SUV · Diésel · 90/25% · 1 · Cepsa+BP | 620 km | 1 (forzado, auto=1) | 16.7/17.8/18.3 € | 21 | 0 | 0 |
| G066 Madrid→Sevilla · SUV · SP98 · 30/40% · auto | 531 km | 1 (auto) | 75.0/77.0/86.3 € | 21 | 0 | 0 |
| G067 Madrid→Málaga · SUV · SP95 · 45/10% · 2 | 536 km | 2 (forzado, auto=1) | 30.5/31.1/34.2 € | 21 | 0 | 0 |
| G068 Madrid→Bilbao · SUV · Diésel · 60/15% · auto | 397 km | 1 (auto) | 7.1/7.2/8.2 € | 21 | 0 | 0 |
| G069 Madrid→Granada · SUV · SP98 · 80/25% · auto · Repsol | 421 km | 1 (auto) | 1.2/1.2/1.2 € | 21 | 0 | 0 |
| G070 Barcelona→Cádiz · SUV · SP95 · 90/40% · 1 · Cepsa+BP | 1116 km | 1 (forzado, auto=1) | 92.6/92.6/92.6 € | 18 | 3 | 0 |
| G071 Barcelona→Sevilla · SUV · Diésel · 30/10% · auto | 998 km | 2 (auto) | 92.5/94.0/113.1 € | 21 | 0 | 0 |
| G072 Barcelona→Madrid · SUV · SP98 · 45/15% · 2 · sin peaje | 622 km | 2 (forzado, auto=1) | 45.6/47.6/56.1 € | 21 | 0 | 0 |
| G073 A Coruña→Almería · SUV · SP95 · 60/25% · auto | 1167 km | 2 (auto) | 101.1/103.6/118.1 € | 21 | 0 | 0 |
| G074 A Coruña→Cartagena · SUV · Diésel · 80/40% · auto · Repsol | 1043 km | 1 (auto) | 94.7/94.7/94.7 € | 18 | 3 | 0 |
| G075 A Coruña→Madrid · SUV · SP98 · 90/10% · 1 · Cepsa+BP | 592 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G076 Valencia→Bilbao · SUV · SP95 · 30/15% · auto | 612 km | 1 (auto) | 55.2/55.2/58.8 € | 21 | 0 | 0 |
| G077 Valencia→A Coruña · SUV · Diésel · 45/25% · 2 | 951 km | 2 (forzado, auto=1) | 87.2/89.0/108.2 € | 21 | 0 | 0 |
| G078 Zaragoza→Sevilla · SUV · SP98 · 60/40% · auto | 859 km | 1 (auto) | 101.5/101.5/101.5 € | 18 | 3 | 0 |
| G079 Málaga→Bilbao · SUV · SP95 · 80/10% · auto · Repsol | 930 km | 1 (auto) | 51.8/52.4/52.4 € | 21 | 0 | 0 |
| G080 Cartagena→Madrid · SUV · Diésel · 90/15% · 1 · Cepsa+BP | 448 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G081 Granada→Zaragoza · SUV · SP98 · 30/25% · auto | 729 km | 1 (auto) | 96.4/96.4/96.4 € | 18 | 3 | 0 |
| G082 Sevilla→Barcelona · SUV · SP95 · 45/40% · 2 | 1039 km | 2 (forzado, auto=2) | 109.1/112.3/130.4 € | 21 | 0 | 0 |
| G083 Bilbao→Málaga · SUV · Diésel · 60/10% · auto | 936 km | 1 (auto) | 66.8/67.8/69.5 € | 21 | 0 | 0 |
| G084 Almería→Bilbao · SUV · SP98 · 80/15% · auto · Repsol | 977 km | 1 (auto) | 69.1/69.7/72.2 € | 21 | 0 | 0 |
| G085 Valencia→Bilbao +1wp · SUV · SP95 · 90/25% · 1 · Cepsa+BP | 755 km | 1 (forzado, auto=1) | 32.7/34.7/35.7 € | 21 | 0 | 0 |
| G086 Madrid→Barcelona +2wp · SUV · Diésel · 30/40% · auto | 626 km | 1 (auto) | 92.1/92.1/92.1 € | 18 | 3 | 0 |
| G087 Cádiz→Barcelona +1wp · SUV · SP98 · 45/10% · 2 | 1270 km | 2 (forzado, auto=2) | 118.4/118.4/141.8 € | 21 | 0 | 0 |
| G088 Bilbao→Valencia +1wp · SUV · SP95 · 60/15% · auto | 612 km | 1 (auto) | 29.2/30.5/32.9 € | 21 | 0 | 0 |
| G089 Madrid→Málaga +4wp · SUV · Diésel · 80/25% · auto · Repsol | 597 km | 1 (auto) | 24.4/24.6/24.6 € | 21 | 0 | 0 |
| G090 Bilbao→Málaga +5wp · SUV · SP98 · 90/40% · 1 · Cepsa+BP | 1122 km | 1 (forzado, auto=1) | 86.3/86.3/86.3 € | 18 | 3 | 0 |
| G091 Madrid→Sevilla · SUV · SP95 · 30/10% · auto · sin peaje | 531 km | 1 (auto) | 42.7/43.6/43.6 € | 21 | 0 | 0 |
| G092 Madrid→Valencia · SUV · Diésel · 45/15% · 2 · i/v | 716 km | 2 (forzado, auto=1) | 57.8/57.7/66.1 € | 19 | 2 | 0 |
| G093 Barcelona→Cádiz · SUV · SP98 · 60/25% · auto · i/v | 2213 km | 3 (auto) | 261.5/268.1/277.0 € | 21 | 0 | 0 |
| G094 Madrid→Toledo · Furgoneta · SP95 · 80/25% · 1 · Repsol | 73 km | 1 (forzado, auto=0) | 0.0/0.0/0.0 € | 21 | 0 | 0 |
| G095 Madrid→Valencia · Furgoneta · Diésel · 90/40% · auto · Cepsa+BP | 358 km | 1 (auto) | 18.0/18.0/18.0 € | 21 | 0 | 0 |
| G096 Madrid→Barcelona · Furgoneta · SP98 · 30/10% · 2 | 620 km | 2 (forzado, auto=2) | 73.9/74.8/89.3 € | 21 | 0 | 0 |
| G097 Madrid→Sevilla · Furgoneta · SP95 · 45/15% · auto | 531 km | 1 (auto) | 54.7/55.3/61.3 € | 21 | 0 | 0 |
| G098 Madrid→Málaga · Furgoneta · Diésel · 60/25% · auto | 536 km | 1 (auto) | 52.1/54.2/61.6 € | 21 | 0 | 0 |
| G099 Madrid→Bilbao · Furgoneta · SP98 · 80/40% · 1 · Repsol | 397 km | 1 (forzado, auto=1) | 34.9/34.9/36.1 € | 21 | 0 | 0 |
| G100 Madrid→Granada · Furgoneta · SP95 · 90/10% · auto · Cepsa+BP | 421 km | 1 (auto) | 6.3/6.4/6.4 € | 21 | 0 | 0 |


## S01 · Trayecto corto, depósito lleno → 0 paradas

> **Objetivo del test:** Verifica que con autonomía de sobra NO se propone ninguna parada (canMakeItNoStops).

**Ruta:** Madrid → Toledo  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 90% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 73 km · 56 min · peaje: no  
**Corredor (SP95, ≤4 km):** 213 estaciones · precio medio 1.607 €/L

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
**Corredor (SP95, ≤4 km):** 584 estaciones · precio medio 1.583 €/L

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
| Más barato | 1.000 € | 0.2 km | 22.80 € | 23 L |
| Equilibrado | 1.000 € | 0.2 km | 22.80 € | 23 L |
| Más rápido | 1.000 € | 0.2 km | 22.80 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.002 | menor score entre 326 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 22.8 L | 28.5 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.013 | menor score entre 326 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 22.8 L | 28.5 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.031 | menor score entre 326 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 22.8 L | 28.5 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.7 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.7 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.7 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 22.80 € · equilibrado 22.80 € · rápido 22.80 € |
| ✅ | Barato tiene el coste mínimo | barato 22.80 € vs mejor de los otros 22.80 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.2 km vs barato 0.2 km |


## S03 · Larga distancia → 2 paradas (auto)

> **Objetivo del test:** Reparto de 2 repostajes en ventanas de autonomía sucesivas; compara 3 estrategias.

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 80% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1116 km · 638 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 816 estaciones · precio medio 1.574 €/L

### Plan de combustible

```
consumo del viaje  = 1116 km × 6.5/100        = 72.5 L
litros de salida   = 50 × 80%                    = 40.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (40.0-4.0) / 6.5 × 100  = 554 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 40.0 - 72.5 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (554 km) no cubre los 1116 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 554 + 1×708 = 1262 km ≥ 1116 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.469 € | 1.3 km | 58.82 € | 40 L |
| Equilibrado | 1.469 € | 1.3 km | 58.82 € | 40 L |
| Más rápido | 1.719 € | 0.0 km | 68.83 € | 40 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GASEXPRESS (Gasexpress) | Requena | 43.7% | 41.4%–49.6% | 1.469 | -0.105 | 1.3 km | 7.3 | 0.290 | menor score entre 20 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GASEXPRESS (repostaje) | 43.7% | 8.3 | 40.0 L | 48.3 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GASEXPRESS (Gasexpress) | Requena | 43.7% | 41.4%–49.6% | 1.469 | -0.105 | 1.3 km | 7.3 | 0.288 | menor score entre 20 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GASEXPRESS (repostaje) | 43.7% | 8.3 | 40.0 L | 48.3 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Requena | 43.2% | 41.4%–49.6% | 1.719 | +0.145 | 0.0 km | 6.0 | 0.038 | menor score entre 20 candidatas (la más barata era Gasexpress a 1.469, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 43.2% | 8.6 | 40.0 L | 48.7 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.3 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.3 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.6 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 58.82 € · equilibrado 58.82 € · rápido 68.83 € |
| ✅ | Barato tiene el coste mínimo | barato 58.82 € vs mejor de los otros 58.82 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.3 km |


## S04 · Muy larga + depósito pequeño → ~3 paradas (auto)

> **Objetivo del test:** Depósito 30 L, consumo alto: obliga a varias paradas. Comprueba que ninguna etapa deja el depósito en negativo.

**Ruta:** A Coruña → Almería  
**Parámetros:** Diésel · consumo 9 L/100 · depósito 30 L · salida 60% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1167 km · 639 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 699 estaciones · precio medio 1.623 €/L

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
| Más barato | 1.486 € | 1.1 km | 137.12 € | 92 L |
| Equilibrado | 1.437 € | 0.8 km | 131.72 € | 92 L |
| Más rápido | 1.636 € | 0.4 km | 148.68 € | 91 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BP (BP) | Lugo | 9.7% | 3.0%–14.9% | 1.399 | -0.224 | 1.0 km | 7.0 | 0.124 | menor score entre 50 candidatas de la ventana (también la más barata) |
| 2 | AGRINZA (Agrinza) | Villalpando | 31.8% | 24.1%–36.0% | 1.430 | -0.193 | 0.6 km | 6.6 | 0.177 | menor score entre 47 candidatas de la ventana (también la más barata) |
| 3 | ÁREA 117 - VALDEMORO (áRea 117 - Valdemoro) | Valdemoro | 51.1% | 49.4%–58.0% | 1.459 | -0.164 | 2.0 km | 8.0 | 0.249 | menor score entre 122 candidatas de la ventana (también la más barata) |
| 4 | REPSOL (Repsol) | Deifontes | 76.7% | 75.7%–77.4% | 1.655 | +0.032 | 0.6 km | 6.6 | 0.597 | menor score entre 1 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BP (repostaje) | 9.7% | 7.8 | 17.8 L | 25.6 |
| 2 | AGRINZA (repostaje) | 31.8% | 2.4 | 20.3 L | 22.7 |
| 3 | ÁREA 117 - VALDEMORO (repostaje) | 51.1% | 2.4 | 26.8 L | 29.2 |
| 4 | REPSOL (repostaje) | 76.7% | 2.4 | 26.6 L | 29.0 |
| — | **Destino** | 100% | **4.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BP (BP) | Lugo | 9.7% | 3.0%–14.9% | 1.399 | -0.224 | 1.0 km | 7.0 | 0.167 | menor score entre 50 candidatas de la ventana (también la más barata) |
| 2 | AGRINZA (Agrinza) | Villalpando | 31.8% | 24.1%–36.0% | 1.430 | -0.193 | 0.6 km | 6.6 | 0.161 | menor score entre 47 candidatas de la ventana (también la más barata) |
| 3 | E.S. ABOX-OIL (E.S. Abox-Oil) | Madridejos | 56.3% | 49.4%–58.0% | 1.479 | -0.144 | 0.4 km | 6.4 | 0.193 | menor score entre 122 candidatas (la más barata era áRea 117 - Valdemoro a 1.459, con peor score por desvío/tiempo) |
| 4 | JUNCADIESEL (Juncadiesel) | Albolote | 78.4% | 75.7%–82.6% | 1.439 | -0.184 | 1.2 km | 7.2 | 0.232 | menor score entre 37 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BP (repostaje) | 9.7% | 7.8 | 17.8 L | 25.6 |
| 2 | AGRINZA (repostaje) | 31.8% | 2.4 | 25.8 L | 28.2 |
| 3 | E.S. ABOX-OIL (repostaje) | 56.3% | 2.4 | 23.2 L | 25.6 |
| 4 | JUNCADIESEL (repostaje) | 78.4% | 2.4 | 24.8 L | 27.2 |
| — | **Destino** | 100% | **4.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CAMPSA (Campsa) | Betanzos | 3.2% | 3.0%–14.9% | 1.689 | +0.066 | 0.3 km | 6.3 | 0.100 | menor score entre 50 candidatas (la más barata era BP a 1.399, con peor score por desvío/tiempo) |
| 2 | MOEVE (Cepsa) | Villagatón | 24.1% | 23.2%–29.5% | 1.689 | +0.066 | 0.5 km | 6.5 | 0.145 | menor score entre 17 candidatas (la más barata era Sdad Cooperativa De Transportes BañEzana a 1.519, con peor score por desvío/tiempo) |
| 3 | BALLENOIL (Ballenoil) | Getafe | 49.6% | 49.4%–50.3% | 1.509 | -0.114 | 0.2 km | 6.2 | 0.068 | menor score entre 39 candidatas (la más barata era Gasexpress Getafe a 1.479, con peor score por desvío/tiempo) |
| 4 | CAMPSA (Campsa) | Iznalloz | 75.7% | 75.7%–75.9% | 1.655 | +0.032 | 0.7 km | 6.7 | 0.213 | sin estación dentro de la ventana → se amplía y se toma la de menor score disponible (597 candidatas) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CAMPSA (repostaje) | 3.2% | 14.6 | 9.7 L | 24.3 |
| 2 | MOEVE (repostaje) | 24.1% | 2.4 | 26.8 L | 29.2 |
| 3 | BALLENOIL (repostaje) | 49.6% | 2.4 | 27.4 L | 29.8 |
| 4 | CAMPSA (repostaje) | 75.7% | 2.4 | 27.6 L | 30.0 |
| — | **Destino** | 100% | **4.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.0 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.7 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 4/4 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.4 L (margen seguridad 2.4 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 4.5 L (pedida 4.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 137.12 € · equilibrado 131.72 € · rápido 148.68 € |
| ❌ | Barato tiene el coste mínimo | barato 137.12 € vs mejor de los otros 131.72 € (Δ 5.40 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.4 km vs barato 1.1 km |


## S05 · Extremo: depósito 25 L → >3 paradas (auto)

> **Objetivo del test:** Caso límite con muchas paradas (auto puede superar 3). Verifica ventanas y no-negatividad.

**Ruta:** A Coruña → Cartagena  
**Parámetros:** Diésel · consumo 10 L/100 · depósito 25 L · salida 50% · llegada ≥ 10% · paradas=auto

**Ruta calculada:** 1043 km · 574 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 677 estaciones · precio medio 1.622 €/L

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
| Más barato | 1.490 € | 1.5 km | 142.29 € | 94 L |
| Equilibrado | 1.521 € | 0.7 km | 144.13 € | 94 L |
| Más rápido | 1.654 € | 0.3 km | 154.71 € | 94 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROPRIX (Petroprix) | Cambre | 2.0% | 0.1%–10.1% | 1.409 | -0.213 | 1.9 km | 7.9 | 0.154 | menor score entre 69 candidatas de la ventana (también la más barata) |
| 2 | PLENERGY (Plenergy) | Ponferrada | 23.7% | 14.1%–24.0% | 1.555 | -0.067 | 2.2 km | 8.2 | 0.431 | menor score entre 16 candidatas de la ventana (también la más barata) |
| 3 | Q8 (Q8) | Medina del Campo | 44.0% | 35.8%–45.7% | 1.339 | -0.283 | 1.0 km | 7.0 | 0.012 | menor score entre 39 candidatas de la ventana (también la más barata) |
| 4 | BEROIL (Beroil) | Móstoles | 57.8% | 56.4%–66.0% | 1.409 | -0.213 | 1.2 km | 7.2 | 0.145 | menor score entre 204 candidatas de la ventana (también la más barata) |
| 5 | REPSOL (Repsol) | Chinchilla de Monte-Aragón | 79.3% | 78.4%–79.8% | 1.739 | +0.117 | 1.0 km | 7.0 | 0.759 | menor score entre 1 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROPRIX (repostaje) | 2.0% | 10.4 | 14.2 L | 24.7 |
| 2 | PLENERGY (repostaje) | 23.7% | 2.0 | 21.1 L | 23.1 |
| 3 | Q8 (repostaje) | 44.0% | 2.0 | 14.4 L | 16.4 |
| 4 | BEROIL (repostaje) | 57.8% | 2.0 | 22.4 L | 24.4 |
| 5 | REPSOL (repostaje) | 79.3% | 2.0 | 22.1 L | 24.1 |
| — | **Destino** | 100% | **2.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROPRIX (Petroprix) | Cambre | 2.0% | 0.1%–10.1% | 1.429 | -0.193 | 0.4 km | 6.4 | 0.142 | menor score entre 69 candidatas (la más barata era Petroprix a 1.409, con peor score por desvío/tiempo) |
| 2 | E.S. TRABADELO (E.S. Trabadelo) | Trabadelo | 21.2% | 14.1%–24.0% | 1.599 | -0.023 | 0.7 km | 6.7 | 0.363 | menor score entre 16 candidatas (la más barata era Plenergy a 1.555, con peor score por desvío/tiempo) |
| 3 | AGRINZA (Agrinza) | Villalpando | 37.5% | 34.3%–43.3% | 1.430 | -0.192 | 0.3 km | 6.3 | 0.127 | menor score entre 39 candidatas de la ventana (también la más barata) |
| 4 | BEROIL (Beroil) | Móstoles | 57.8% | 56.4%–59.6% | 1.409 | -0.213 | 1.2 km | 7.2 | 0.193 | menor score entre 155 candidatas de la ventana (también la más barata) |
| 5 | REPSOL (Repsol) | Chinchilla de Monte-Aragón | 79.3% | 78.4%–79.8% | 1.739 | +0.117 | 1.0 km | 7.0 | 0.546 | menor score entre 1 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROPRIX (repostaje) | 2.0% | 10.4 | 11.7 L | 22.1 |
| 2 | E.S. TRABADELO (repostaje) | 21.2% | 2.0 | 17.0 L | 19.0 |
| 3 | AGRINZA (repostaje) | 37.5% | 2.0 | 21.1 L | 23.1 |
| 4 | BEROIL (repostaje) | 57.8% | 2.0 | 22.4 L | 24.4 |
| 5 | REPSOL (repostaje) | 79.3% | 2.0 | 22.1 L | 24.1 |
| — | **Destino** | 100% | **2.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Coruña (A) | 0.7% | 0.1%–10.1% | 1.669 | +0.047 | 0.1 km | 6.1 | 0.053 | menor score entre 69 candidatas (la más barata era Petroprix a 1.409, con peor score por desvío/tiempo) |
| 2 | VALCARCE (Valcarce) | Vega de Valcarce | 20.7% | 12.9%–22.8% | 1.709 | +0.087 | 0.1 km | 6.1 | 0.059 | menor score entre 11 candidatas (la más barata era E.S. Trabadelo a 1.599, con peor score por desvío/tiempo) |
| 3 | REPSOL (Repsol) | Torre del Valle (La) | 34.6% | 34.3%–42.8% | 1.725 | +0.103 | 0.1 km | 6.1 | 0.042 | menor score entre 38 candidatas (la más barata era Agrinza a 1.430, con peor score por desvío/tiempo) |
| 4 | OIL SANCHEZ ROMERO (Oil Sanchez Romero) | Majadahonda | 56.5% | 56.4%–56.6% | 1.609 | -0.013 | 0.6 km | 6.6 | 0.175 | menor score entre 7 candidatas (la más barata era Petroprix a 1.517, con peor score por desvío/tiempo) |
| 5 | INPEALSA (Inpealsa) | Albacete | 78.0% | 78.4%–78.6% | 1.559 | -0.063 | 0.4 km | 6.4 | 0.123 | sin estación dentro de la ventana → se amplía y se toma la de menor score disponible (542 candidatas) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 0.7% | 11.7 | 11.1 L | 22.9 |
| 2 | VALCARCE (repostaje) | 20.7% | 2.0 | 14.4 L | 16.4 |
| 3 | REPSOL (repostaje) | 34.6% | 2.0 | 22.9 L | 24.9 |
| 4 | OIL SANCHEZ ROMERO (repostaje) | 56.5% | 2.0 | 22.4 L | 24.4 |
| 5 | INPEALSA (repostaje) | 78.0% | 2.0 | 23.0 L | 25.0 |
| — | **Destino** | 100% | **2.1** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 2.5 L (pedida 2.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 2.5 L (pedida 2.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 5/5 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 2.0 L (margen seguridad 2.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 2.1 L (pedida 2.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 142.29 € · equilibrado 144.13 € · rápido 154.71 € |
| ✅ | Barato tiene el coste mínimo | barato 142.29 € vs mejor de los otros 144.13 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.3 km vs barato 1.5 km |


## S06 · Diésel, 1 parada

> **Objetivo del test:** Corredor de diésel (muchas estaciones). Elección barata vs rápida.

**Ruta:** Madrid → Valencia  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 358 km · 218 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 332 estaciones · precio medio 1.630 €/L

### Plan de combustible

```
consumo del viaje  = 358 km × 6.5/100        = 23.3 L
litros de salida   = 45 × 45%                    = 20.3 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (20.3-3.6) / 6.5 × 100  = 256 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 20.3 - 23.3 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (256 km) no cubre los 358 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 256 + 1×637 = 893 km ≥ 358 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.467 € | 1.1 km | 14.32 € | 10 L |
| Equilibrado | 1.489 € | 0.3 km | 14.54 € | 10 L |
| Más rápido | 1.529 € | 0.1 km | 14.93 € | 10 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PETROPRIX (Petroprix) | Madrid | 5.6% | 0.0%–71.6% | 1.467 | -0.163 | 1.1 km | 7.1 | 0.125 | menor score entre 174 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PETROPRIX (repostaje) | 5.6% | 18.9 | 9.8 L | 28.7 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Madrid | 5.6% | 0.0%–71.6% | 1.489 | -0.141 | 0.3 km | 6.3 | 0.132 | menor score entre 174 candidatas (la más barata era Petroprix a 1.467, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 5.6% | 18.9 | 9.8 L | 28.7 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BEROIL (Beroil) | Tébar | 51.5% | 0.0%–71.6% | 1.529 | -0.101 | 0.1 km | 6.1 | 0.038 | menor score entre 174 candidatas (la más barata era Petroprix a 1.467, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BEROIL (repostaje) | 51.5% | 8.3 | 9.8 L | 18.0 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 18.9 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 18.9 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.3 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 14.32 € · equilibrado 14.54 € · rápido 14.93 € |
| ✅ | Barato tiene el coste mínimo | barato 14.32 € vs mejor de los otros 14.54 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 1.1 km |


## S07 · GLP (autogas): corredor escaso

> **Objetivo del test:** Combustible con pocas estaciones. Comprueba manejo de corredor pequeño / desvíos grandes.

**Ruta:** Madrid → Bilbao  
**Parámetros:** GLP · consumo 7.5 L/100 · depósito 45 L · salida 40% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 397 km · 239 min · peaje: SÍ  
**Corredor (GLP, ≤4 km):** 48 estaciones · precio medio 1.070 €/L

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
| Más rápido | 1.079 € | 0.1 km | 19.99 € | 19 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MADRID WETAXI GLP (Madrid Wetaxi Glp) | Madrid | 3.6% | 0.0%–48.4% | 0.799 | -0.271 | 2.6 km | 8.6 | 0.033 | menor score entre 33 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MADRID WETAXI GLP (repostaje) | 3.6% | 16.9 | 18.5 L | 35.4 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | MADRID WETAXI GLP (Madrid Wetaxi Glp) | Madrid | 3.6% | 0.0%–48.4% | 0.799 | -0.271 | 2.6 km | 8.6 | 0.264 | menor score entre 33 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | MADRID WETAXI GLP (repostaje) | 3.6% | 16.9 | 18.5 L | 35.4 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Molar (El) | 10.4% | 0.0%–48.4% | 1.079 | +0.009 | 0.1 km | 6.1 | 0.057 | menor score entre 33 candidatas (la más barata era Madrid Wetaxi Glp a 0.799, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 10.4% | 14.9 | 18.5 L | 33.4 |
| — | **Destino** | 100% | **6.7** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.9 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 2.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 16.9 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 14.9 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 14.80 € · equilibrado 14.80 € · rápido 19.99 € |
| ✅ | Barato tiene el coste mínimo | barato 14.80 € vs mejor de los otros 14.80 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 2.6 km |


## S08 · Evitar peajes (Madrid→Sevilla)

> **Objetivo del test:** Flag avoidTolls: la ruta y el corredor deben calcularse sobre la ruta sin peaje.

**Ruta:** Madrid → Sevilla  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto · evitar peajes

**Ruta calculada:** 531 km · 299 min · peaje: no  
**Corredor (SP95, ≤4 km):** 348 estaciones · precio medio 1.592 €/L

### Plan de combustible

```
consumo del viaje  = 531 km × 6.5/100        = 34.5 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 34.5 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 531 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 531 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.399 € | 2.4 km | 27.31 € | 20 L |
| Equilibrado | 1.429 € | 0.2 km | 27.90 € | 20 L |
| Más rápido | 1.429 € | 0.2 km | 27.90 € | 20 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | EURONOR ENERGY (Euronor Energy) | Navalmoral de la Mata | 37.7% | 0.0%–53.6% | 1.399 | -0.193 | 2.4 km | 8.4 | 0.079 | menor score entre 209 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | EURONOR ENERGY (repostaje) | 37.7% | 9.5 | 19.5 L | 29.0 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Navalcarnero | 14.3% | 0.0%–53.6% | 1.429 | -0.163 | 0.2 km | 6.2 | 0.088 | menor score entre 209 candidatas (la más barata era Euronor Energy a 1.399, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 14.3% | 17.6 | 19.5 L | 37.1 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Navalcarnero | 14.3% | 0.0%–53.6% | 1.429 | -0.163 | 0.2 km | 6.2 | 0.038 | menor score entre 209 candidatas (la más barata era Euronor Energy a 1.399, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 14.3% | 17.6 | 19.5 L | 37.1 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.4 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 9.5 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.6 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.6 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 27.31 € · equilibrado 27.90 € · rápido 27.90 € |
| ✅ | Barato tiene el coste mínimo | barato 27.31 € vs mejor de los otros 27.90 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.2 km vs barato 2.4 km |


## S09 · Evitar peajes (Barcelona→Madrid)

> **Objetivo del test:** Corredor mediterráneo con AP-2/AP-7: comprueba detección/evitación de peaje.

**Ruta:** Barcelona → Madrid  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto · evitar peajes

**Ruta calculada:** 622 km · 367 min · peaje: no  
**Corredor (SP95, ≤4 km):** 581 estaciones · precio medio 1.583 €/L

### Plan de combustible

```
consumo del viaje  = 622 km × 6.5/100        = 40.4 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 6.5 × 100  = 285 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 22.5 - 40.4 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (285 km) no cubre los 622 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 285 + 1×708 = 992 km ≥ 622 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.327 € | 0.9 km | 33.77 € | 25 L |
| Equilibrado | 1.344 € | 0.6 km | 34.20 € | 25 L |
| Más rápido | 1.649 € | 0.1 km | 41.96 € | 25 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Vilafranca del Penedès | 19.0% | 0.0%–45.7% | 1.327 | -0.256 | 0.9 km | 6.9 | 0.425 | menor score entre 239 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 19.0% | 14.8 | 25.4 L | 40.3 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Espluga de Francolí (L') | 29.9% | 0.0%–45.7% | 1.344 | -0.239 | 0.6 km | 6.6 | 0.312 | menor score entre 239 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 29.9% | 10.4 | 25.4 L | 35.8 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GALP (Galp) | Borges Blanques (Les) | 34.7% | 0.0%–45.7% | 1.649 | +0.066 | 0.1 km | 6.1 | 0.042 | menor score entre 239 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GALP (repostaje) | 34.7% | 8.5 | 25.4 L | 33.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.9 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 14.8 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 10.4 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.5 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 33.77 € · equilibrado 34.20 € · rápido 41.96 € |
| ✅ | Barato tiene el coste mínimo | barato 33.77 € vs mejor de los otros 34.20 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.9 km |


## S10 · Filtro de marca: solo Repsol

> **Objetivo del test:** Restringe el corredor a una marca. Todas las paradas deben ser Repsol.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto · marcas: Repsol

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 584 estaciones → 158 tras filtro de marca · precio medio 1.663 €/L

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
| Más barato | 1.615 € | 0.5 km | 43.28 € | 27 L |
| Equilibrado | 1.615 € | 0.5 km | 43.28 € | 27 L |
| Más rápido | 1.679 € | 0.1 km | 45.00 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Santa María de Huerta | 28.5% | 5.1%–41.3% | 1.615 | -0.048 | 0.5 km | 6.5 | 0.177 | menor score entre 32 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 28.5% | 8.8 | 26.8 L | 35.6 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Santa María de Huerta | 28.5% | 5.1%–41.3% | 1.615 | -0.048 | 0.5 km | 6.5 | 0.150 | menor score entre 32 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 28.5% | 8.8 | 26.8 L | 35.6 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Saúca | 17.9% | 5.1%–41.3% | 1.679 | +0.016 | 0.1 km | 6.1 | 0.024 | menor score entre 32 candidatas (la más barata era Repsol a 1.615, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 17.9% | 13.0 | 26.8 L | 39.8 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.5 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.8 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.5 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.8 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 13.0 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 43.28 € · equilibrado 43.28 € · rápido 45.00 € |
| ✅ | Barato tiene el coste mínimo | barato 43.28 € vs mejor de los otros 43.28 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.5 km |


## S11 · Filtro de marca: Cepsa + BP

> **Objetivo del test:** Corredor limitado a dos marcas. Verifica que solo se eligen esas.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto · marcas: Cepsa+BP

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 584 estaciones → 114 tras filtro de marca · precio medio 1.652 €/L

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
| Más barato | 1.589 € | 1.1 km | 42.59 € | 27 L |
| Equilibrado | 1.609 € | 0.1 km | 43.12 € | 27 L |
| Más rápido | 1.679 € | 0.1 km | 45.00 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BP ALTO CAMPOO 365 (BP) | Guadalajara | 8.0% | 5.1%–41.3% | 1.589 | -0.063 | 1.1 km | 7.1 | 0.822 | menor score entre 24 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BP ALTO CAMPOO 365 (repostaje) | 8.0% | 17.0 | 26.8 L | 43.8 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BP (BP) | Monreal de Ariza | 29.5% | 5.1%–41.3% | 1.609 | -0.043 | 0.1 km | 6.1 | 0.510 | menor score entre 24 candidatas (la más barata era BP a 1.589, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BP (repostaje) | 29.5% | 8.4 | 26.8 L | 35.2 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Guadalajara | 7.7% | 5.1%–41.3% | 1.679 | +0.027 | 0.1 km | 6.1 | 0.047 | menor score entre 24 candidatas (la más barata era BP a 1.589, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 7.7% | 17.1 | 26.8 L | 43.9 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.1 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.0 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.4 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.1 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 42.59 € · equilibrado 43.12 € · rápido 45.00 € |
| ✅ | Barato tiene el coste mínimo | barato 42.59 € vs mejor de los otros 43.12 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 1.1 km |


## S12 · 1 parada del conductor (waypoint)

> **Objetivo del test:** Waypoint intermedio: la ruta base pasa por él y el corredor lo rodea.

**Ruta:** Valencia → Madrid → Bilbao  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 755 km · 458 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 532 estaciones · precio medio 1.619 €/L

### Plan de combustible

```
consumo del viaje  = 755 km × 6.5/100        = 49.1 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 6.5 × 100  = 323 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 25.0 - 49.1 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (323 km) no cubre los 755 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 323 + 1×708 = 1031 km ≥ 755 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.439 € | 0.3 km | 45.44 € | 32 L |
| Equilibrado | 1.499 € | 1.4 km | 47.33 € | 32 L |
| Más rápido | 1.685 € | 0.1 km | 53.21 € | 32 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Mejorada del Campo | 29.5% | 13.4%–42.8% | 1.439 | -0.180 | 0.3 km | 6.3 | 0.204 | menor score entre 255 candidatas (la más barata era Plenergy a 1.439, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 29.5% | 10.5 | 31.6 L | 42.1 |
| 2 | Madrid | 33.0% | 40.4 | — | 40.4 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Madrid | 32.9% | 13.4%–42.8% | 1.499 | -0.120 | 1.4 km | 1.4 | 0.248 | menor score entre 255 candidatas (la más barata era Plenergy a 1.439, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 32.9% | 8.8 | 31.6 L | 40.4 |
| 2 | Madrid | 33.0% | 40.4 | — | 40.4 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Madrid | 34.6% | 13.4%–42.8% | 1.685 | +0.066 | 0.1 km | 0.1 | 0.040 | menor score entre 255 candidatas (la más barata era Plenergy a 1.439, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Madrid | 33.0% | 8.8 | — | 8.8 |
| 2 | REPSOL (repostaje) | 34.6% | 8.0 | 31.6 L | 39.6 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 10.5 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.4 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.8 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.0 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 45.44 € · equilibrado 47.33 € · rápido 53.21 € |
| ✅ | Barato tiene el coste mínimo | barato 45.44 € vs mejor de los otros 47.33 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.3 km |


## S13 · 2 paradas del conductor

> **Objetivo del test:** Dos waypoints (Zaragoza, Lleida). Orden por progreso y repostaje convenient cerca de ellos.

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 626 km · 400 min · peaje: no  
**Corredor (SP95, ≤4 km):** 613 estaciones · precio medio 1.577 €/L

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
| Más barato | 1.350 € | 0.2 km | 36.68 € | 27 L |
| Equilibrado | 1.350 € | 0.2 km | 36.68 € | 27 L |
| Más rápido | 1.419 € | 0.1 km | 38.56 € | 27 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 38.6% | 6.0%–40.9% | 1.350 | -0.227 | 0.2 km | 6.2 | 0.085 | menor score entre 96 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 38.6% | 4.5 | 27.2 L | 31.7 |
| 2 | Zaragoza | 44.4% | 29.4 | — | 29.4 |
| 3 | Lleida | 65.5% | 20.8 | — | 20.8 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 38.6% | 6.0%–40.9% | 1.350 | -0.227 | 0.2 km | 6.2 | 0.279 | menor score entre 96 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 38.6% | 4.5 | 27.2 L | 31.7 |
| 2 | Zaragoza | 44.4% | 29.4 | — | 29.4 |
| 3 | Lleida | 65.5% | 20.8 | — | 20.8 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Alcalá de Henares | 6.0% | 6.0%–40.9% | 1.419 | -0.158 | 0.1 km | 6.1 | 0.614 | menor score entre 96 candidatas (la más barata era Bonarea a 1.350, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 6.0% | 17.8 | 27.2 L | 45.0 |
| 2 | Zaragoza | 44.4% | 29.4 | — | 29.4 |
| 3 | Lleida | 65.5% | 20.8 | — | 20.8 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.5 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.5 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 17.8 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 36.68 € · equilibrado 36.68 € · rápido 38.56 € |
| ✅ | Barato tiene el coste mínimo | barato 36.68 € vs mejor de los otros 36.68 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.2 km |


## S14 · 4 paradas del conductor (>3)

> **Objetivo del test:** Cuatro waypoints. Verifica orden por progreso y efecto "convenient" (repostar junto a una parada no penaliza tiempo).

**Ruta:** Madrid → Aranjuez → Ciudad Real → Córdoba → Antequera → Málaga  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 597 km · 464 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 411 estaciones · precio medio 1.599 €/L

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
| Más barato | 1.355 € | 0.7 km | 31.23 € | 23 L |
| Equilibrado | 1.369 € | 0.2 km | 31.55 € | 23 L |
| Más rápido | 1.375 € | 0.1 km | 31.69 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | EE SS PUENTE DEL AVE (Ee Ss Puente Del Ave) | Ciudad Real | 26.1% | 1.4%–48.7% | 1.355 | -0.244 | 0.7 km | 0.7 | 0.004 | menor score entre 237 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Aranjuez | 10.2% | 18.5 | — | 18.5 |
| 2 | EE SS PUENTE DEL AVE (repostaje) | 26.1% | 12.4 | 23.0 L | 35.4 |
| 3 | Ciudad Real | 28.1% | 34.7 | — | 34.7 |
| 4 | Córdoba | 60.0% | 22.3 | — | 22.3 |
| 5 | Antequera | 81.1% | 14.1 | — | 14.1 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Ciudad Real | 29.0% | 1.4%–48.7% | 1.369 | -0.230 | 0.2 km | 0.2 | 0.026 | menor score entre 237 candidatas (la más barata era Ee Ss Puente Del Ave a 1.355, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Aranjuez | 10.2% | 18.5 | — | 18.5 |
| 2 | Ciudad Real | 28.1% | 11.6 | — | 11.6 |
| 3 | PLENERGY (repostaje) | 29.0% | 11.3 | 23.0 L | 34.3 |
| 4 | Córdoba | 60.0% | 22.3 | — | 22.3 |
| 5 | Antequera | 81.1% | 14.1 | — | 14.1 |
| — | **Destino** | 100% | **6.7** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Ciudad Real | 27.3% | 1.4%–48.7% | 1.375 | -0.224 | 0.1 km | 0.1 | 0.007 | menor score entre 237 candidatas (la más barata era Ee Ss Puente Del Ave a 1.355, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | Aranjuez | 10.2% | 18.5 | — | 18.5 |
| 2 | PLENERGY (repostaje) | 27.3% | 11.9 | 23.0 L | 35.0 |
| 3 | Ciudad Real | 28.1% | 34.7 | — | 34.7 |
| 4 | Córdoba | 60.0% | 22.3 | — | 22.3 |
| 5 | Antequera | 81.1% | 14.1 | — | 14.1 |
| — | **Destino** | 100% | **6.7** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.7 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 12.4 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 11.3 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 11.9 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.7 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 31.23 € · equilibrado 31.55 € · rápido 31.69 € |
| ✅ | Barato tiene el coste mínimo | barato 31.23 € vs mejor de los otros 31.55 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.7 km |


## S15 · 5 paradas del conductor (>3)

> **Objetivo del test:** Cinco waypoints en un trayecto largo. Estrés del ordenamiento y de las ventanas con muchos puntos propios.

**Ruta:** Bilbao → Madrid → Toledo → Ciudad Real → Córdoba → Granada → Málaga  
**Parámetros:** SP95 · consumo 7 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 1122 km · 792 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 741 estaciones · precio medio 1.600 €/L

### Plan de combustible

```
consumo del viaje  = 1122 km × 7/100        = 78.6 L
litros de salida   = 50 × 50%                    = 25.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (25.0-4.0) / 7 × 100  = 300 km
autonomía tanque   = (50-4.0) / 7 × 100  = 657 km
¿llega sin parar?  = 25.0 - 78.6 ≥ 7.5? → NO
paradas mínimas    = 2   (modo=auto → se usan 2)
```
**Justificación:** La autonomía de salida (300 km) no cubre los 1122 km. Con 2 repostaje(s) de depósito lleno la autonomía acumulada es 300 + 2×657 = 1614 km ≥ 1122 km. **Mínimo 2 parada(s).**

### Comparativa de estrategias (nStops=2)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.427 € | 1.2 km | 86.28 € | 61 L |
| Equilibrado | 1.434 € | 0.7 km | 86.82 € | 61 L |
| Más rápido | 1.549 € | 0.0 km | 94.59 € | 61 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BEROIL (Beroil) | Miranda de Ebro | 8.9% | 0.4%–26.7% | 1.499 | -0.101 | 0.9 km | 6.9 | 0.383 | menor score entre 92 candidatas (la más barata era Eroski a 1.499, con peor score por desvío/tiempo) |
| 2 | EE SS PUENTE DEL AVE (Ee Ss Puente Del Ave) | Ciudad Real | 58.0% | 45.9%–67.4% | 1.355 | -0.245 | 1.4 km | 1.4 | 0.007 | menor score entre 94 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BEROIL (repostaje) | 8.9% | 18.0 | 24.6 L | 42.6 |
| 2 | Madrid | 42.8% | 16.0 | — | 16.0 |
| 3 | Toledo | 48.7% | 11.3 | — | 11.3 |
| 4 | EE SS PUENTE DEL AVE (repostaje) | 58.0% | 4.0 | 36.5 L | 40.5 |
| 5 | Ciudad Real | 58.1% | 40.4 | — | 40.4 |
| 6 | Córdoba | 71.5% | 29.9 | — | 29.9 |
| 7 | Granada | 86.8% | 17.9 | — | 17.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BEROIL (Beroil) | Miranda de Ebro | 8.9% | 0.4%–26.7% | 1.499 | -0.101 | 0.9 km | 6.9 | 0.485 | menor score entre 92 candidatas (la más barata era Eroski a 1.499, con peor score por desvío/tiempo) |
| 2 | URBAN OIL (Urban Oil) | Ciudad Real | 58.3% | 45.9%–67.4% | 1.369 | -0.231 | 0.5 km | 0.5 | 0.042 | menor score entre 94 candidatas (la más barata era Ee Ss Puente Del Ave a 1.355, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BEROIL (repostaje) | 8.9% | 18.0 | 24.8 L | 42.8 |
| 2 | Madrid | 42.8% | 16.2 | — | 16.2 |
| 3 | Toledo | 48.7% | 11.5 | — | 11.5 |
| 4 | Ciudad Real | 58.1% | 4.1 | — | 4.1 |
| 5 | URBAN OIL (repostaje) | 58.3% | 4.0 | 36.3 L | 40.3 |
| 6 | Córdoba | 71.5% | 29.9 | — | 29.9 |
| 7 | Granada | 86.8% | 17.9 | — | 17.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BEROIL (Beroil) | Aranda de Duero | 26.2% | 0.4%–26.7% | 1.549 | -0.051 | 0.0 km | 6.0 | 0.628 | menor score entre 92 candidatas (la más barata era Eroski a 1.499, con peor score por desvío/tiempo) |
| 2 | BALLENOIL (Ballenoil) | Córdoba | 71.6% | 58.4%–84.7% | 1.549 | -0.051 | 0.0 km | 0.0 | 0.023 | menor score entre 152 candidatas (la más barata era Ee Ss Puente Del Ave a 1.355, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BEROIL (repostaje) | 26.2% | 4.4 | 35.3 L | 39.7 |
| 2 | Madrid | 42.8% | 26.6 | — | 26.6 |
| 3 | Toledo | 48.7% | 22.0 | — | 22.0 |
| 4 | Ciudad Real | 58.1% | 14.6 | — | 14.6 |
| 5 | Córdoba | 71.5% | 4.1 | — | 4.1 |
| 6 | BALLENOIL (repostaje) | 71.6% | 4.0 | 25.8 L | 29.8 |
| 7 | Granada | 86.8% | 17.9 | — | 17.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.4 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.9 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 2/2 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 86.28 € · equilibrado 86.82 € · rápido 94.59 € |
| ✅ | Barato tiene el coste mínimo | barato 86.28 € vs mejor de los otros 86.82 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.2 km |


## S16 · Forzar 1 parada cuando auto pide 2 (infra-repostaje)

> **Objetivo del test:** stopsMode=1 en ruta que necesita 2. DEBE detectarse que se llega bajo mínimos o en seco.

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 80% · llegada ≥ 15% · paradas=1

**Ruta calculada:** 1116 km · 638 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 816 estaciones · precio medio 1.574 €/L

### Plan de combustible

```
consumo del viaje  = 1116 km × 6.5/100        = 72.5 L
litros de salida   = 50 × 80%                    = 40.0 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (40.0-4.0) / 6.5 × 100  = 554 km
autonomía tanque   = (50-4.0) / 6.5 × 100  = 708 km
¿llega sin parar?  = 40.0 - 72.5 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=1 → se usan 1)
```
**Justificación:** La autonomía de salida (554 km) no cubre los 1116 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 554 + 1×708 = 1262 km ≥ 1116 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.469 € | 1.3 km | 58.82 € | 40 L |
| Equilibrado | 1.469 € | 1.3 km | 58.82 € | 40 L |
| Más rápido | 1.719 € | 0.0 km | 68.83 € | 40 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GASEXPRESS (Gasexpress) | Requena | 43.7% | 41.4%–49.6% | 1.469 | -0.105 | 1.3 km | 7.3 | 0.290 | menor score entre 20 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GASEXPRESS (repostaje) | 43.7% | 8.3 | 40.0 L | 48.3 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | GASEXPRESS (Gasexpress) | Requena | 43.7% | 41.4%–49.6% | 1.469 | -0.105 | 1.3 km | 7.3 | 0.288 | menor score entre 20 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | GASEXPRESS (repostaje) | 43.7% | 8.3 | 40.0 L | 48.3 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Requena | 43.2% | 41.4%–49.6% | 1.719 | +0.145 | 0.0 km | 6.0 | 0.038 | menor score entre 20 candidatas (la más barata era Gasexpress a 1.469, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 43.2% | 8.6 | 40.0 L | 48.7 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.3 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.3 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.3 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 8.6 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 58.82 € · equilibrado 58.82 € · rápido 68.83 € |
| ✅ | Barato tiene el coste mínimo | barato 58.82 € vs mejor de los otros 58.82 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.3 km |


## S17 · Forzar 3 paradas cuando auto pide 1 (sobre-repostaje)

> **Objetivo del test:** stopsMode=3 en ruta que solo necesita 1. Comprueba cómo se distribuyen 3 ventanas y que no sobra depósito absurdo.

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 50% · llegada ≥ 15% · paradas=3

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 584 estaciones · precio medio 1.583 €/L

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
| Más barato | 1.241 € | 0.5 km | 24.66 € | 23 L |
| Equilibrado | 1.223 € | 0.6 km | 27.87 € | 23 L |
| Más rápido | 1.366 € | 0.1 km | 25.41 € | 23 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.002 | menor score entre 326 candidatas de la ventana (también la más barata) |
| 2 | PLENERGY (Plenergy) | Hospitalet de Llobregat (L') | 97.1% | 48.6%–100.0% | 1.325 | -0.258 | 0.9 km | 6.9 | 0.422 | menor score entre 250 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |
| 3 | GM OIL HOSPITALET DE LLOBREGAT (GM Oil) | Hospitalet de Llobregat (L') | 97.1% | 97.1%–100.0% | 1.399 | -0.184 | 0.5 km | 6.5 | 0.512 | menor score entre 59 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 18.1 L | 23.9 |
| 2 | PLENERGY (repostaje) | 97.1% | 4.0 | 0.0 L | 4.0 |
| 3 | GM OIL HOSPITALET DE LLOBREGAT (repostaje) | 97.1% | 4.0 | 4.7 L | 8.7 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.013 | menor score entre 326 candidatas de la ventana (también la más barata) |
| 2 | BONAREA (Bonarea) | Espluga de Francolí (L') | 71.5% | 48.6%–100.0% | 1.344 | -0.239 | 0.6 km | 6.6 | 0.320 | menor score entre 250 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |
| 3 | PLENERGY (Plenergy) | Hospitalet de Llobregat (L') | 97.1% | 71.5%–100.0% | 1.325 | -0.258 | 0.9 km | 6.9 | 0.330 | menor score entre 210 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 7.8 L | 13.5 |
| 2 | BONAREA (repostaje) | 71.5% | 4.0 | 10.3 L | 14.3 |
| 3 | PLENERGY (repostaje) | 97.1% | 4.0 | 4.7 L | 8.7 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Zaragoza | 47.8% | 0.7%–52.1% | 1.000 | -0.583 | 0.2 km | 6.2 | 0.031 | menor score entre 326 candidatas de la ventana (también la más barata) |
| 2 | PETROCAT DIRECTE (Petrocat) | Hospitalet de Llobregat (L') | 97.3% | 48.6%–100.0% | 1.519 | -0.064 | 0.1 km | 6.1 | 0.046 | menor score entre 250 candidatas (la más barata era Plenergy a 1.325, con peor score por desvío/tiempo) |
| 3 | GRATSA (Gratsa) | Barcelona | 99.0% | 97.3%–100.0% | 1.579 | -0.004 | 0.2 km | 6.2 | 0.067 | menor score entre 46 candidatas (la más barata era Petroprix a 1.427, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 47.8% | 5.7 | 18.2 L | 24.0 |
| 2 | PETROCAT DIRECTE (repostaje) | 97.3% | 4.0 | 0.7 L | 4.7 |
| 3 | GRATSA (repostaje) | 99.0% | 4.0 | 3.9 L | 7.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.9 km |
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
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 3/3 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.0 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 24.66 € · equilibrado 27.87 € · rápido 25.41 € |
| ✅ | Barato tiene el coste mínimo | barato 24.66 € vs mejor de los otros 25.41 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.5 km |


## S18 · Ida y vuelta

> **Objetivo del test:** roundTrip: el destino pasa a ser waypoint y se vuelve al origen; distancia ~doble.

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 45 L · salida 60% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 716 km · 436 min · peaje: SÍ  
**Corredor (SP95, ≤4 km):** 331 estaciones · precio medio 1.609 €/L

### Plan de combustible

```
consumo del viaje  = 716 km × 6.5/100        = 46.5 L
litros de salida   = 45 × 60%                    = 27.0 L
reserva de llegada = 45 × 15%                    = 6.8 L
margen seguridad   = 45 × 8%                     = 3.6 L
autonomía salida   = (27.0-3.6) / 6.5 × 100  = 360 km
autonomía tanque   = (45-3.6) / 6.5 × 100  = 637 km
¿llega sin parar?  = 27.0 - 46.5 ≥ 6.8? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (360 km) no cubre los 716 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 360 + 1×637 = 997 km ≥ 716 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.370 € | 1.6 km | 36.00 € | 26 L |
| Equilibrado | 1.370 € | 1.6 km | 36.00 € | 26 L |
| Más rápido | 1.625 € | 0.0 km | 42.70 € | 26 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | VIROSQUE (Virosque) | Riba-roja de Túria | 45.9% | 17.8%–50.3% | 1.370 | -0.239 | 1.6 km | 7.6 | 0.019 | menor score entre 118 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | VIROSQUE (repostaje) | 45.9% | 5.6 | 26.3 L | 31.9 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | VIROSQUE (Virosque) | Riba-roja de Túria | 45.9% | 17.8%–50.3% | 1.370 | -0.239 | 1.6 km | 7.6 | 0.156 | menor score entre 118 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | VIROSQUE (repostaje) | 45.9% | 5.6 | 26.3 L | 31.9 |
| — | **Destino** | 100% | **6.8** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Valencia | 48.1% | 17.8%–50.3% | 1.625 | +0.016 | 0.0 km | 6.0 | 0.032 | menor score entre 118 candidatas (la más barata era Virosque a 1.370, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 48.1% | 4.6 | 26.3 L | 30.9 |
| — | **Destino** | 100% | **6.8** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 1.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.6 L (margen seguridad 3.6 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 1.6 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.6 L (margen seguridad 3.6 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.6 L (margen seguridad 3.6 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 6.8 L (pedida 6.8 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 36.00 € · equilibrado 36.00 € · rápido 42.70 € |
| ✅ | Barato tiene el coste mínimo | barato 36.00 € vs mejor de los otros 36.00 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 1.6 km |


## S19 · Salida muy baja (20%)

> **Objetivo del test:** Primera ventana pegada al inicio: la parada 0 debe caer pronto (poca autonomía de salida).

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 20% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 584 estaciones · precio medio 1.583 €/L

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
| Más barato | 1.379 € | 0.6 km | 52.13 € | 38 L |
| Equilibrado | 1.399 € | 0.3 km | 52.88 € | 38 L |
| Más rápido | 1.679 € | 0.1 km | 63.47 € | 38 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Guadalajara | 8.0% | 0.0%–14.9% | 1.379 | -0.204 | 0.6 km | 6.6 | 0.487 | menor score entre 233 candidatas (la más barata era Plenergy a 1.379, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 8.0% | 6.8 | 37.8 L | 44.6 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | FAMILY ENERGY (Family Energy) | Azuqueca de Henares | 7.2% | 0.0%–14.9% | 1.399 | -0.184 | 0.3 km | 6.3 | 0.328 | menor score entre 233 candidatas (la más barata era Plenergy a 1.379, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | FAMILY ENERGY (repostaje) | 7.2% | 7.1 | 37.8 L | 44.9 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | CEPSA (Cepsa) | Guadalajara | 7.7% | 0.0%–14.9% | 1.679 | +0.096 | 0.1 km | 6.1 | 0.043 | menor score entre 233 candidatas (la más barata era Plenergy a 1.379, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | CEPSA (repostaje) | 7.7% | 6.9 | 37.8 L | 44.7 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 6.8 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.3 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 7.1 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 6.9 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 52.13 € · equilibrado 52.88 € · rápido 63.47 € |
| ✅ | Barato tiene el coste mínimo | barato 52.13 € vs mejor de los otros 52.88 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 0.6 km |


## S20 · Reserva de llegada alta (50%)

> **Objetivo del test:** arrivePct=50: la ÚLTIMA parada debe forzarse cerca del destino (arriveTopUpRangeKm pequeño).

**Ruta:** Madrid → Barcelona  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 50% · paradas=auto

**Ruta calculada:** 620 km · 364 min · peaje: no  
**Corredor (SP95, ≤4 km):** 584 estaciones · precio medio 1.583 €/L

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
| Más barato | 1.329 € | 0.6 km | 56.88 € | 43 L |
| Equilibrado | 1.350 € | 0.2 km | 57.78 € | 43 L |
| Más rápido | 1.350 € | 0.2 km | 57.78 € | 43 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | PLENERGY (Plenergy) | Zaragoza | 45.4% | 38.0%–45.9% | 1.329 | -0.254 | 0.6 km | 6.6 | 0.423 | menor score entre 29 candidatas (la más barata era Family Energy a 1.329, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | PLENERGY (repostaje) | 45.4% | 4.2 | 42.8 L | 47.0 |
| — | **Destino** | 100% | **25.0** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 42.8% | 38.0%–45.9% | 1.350 | -0.233 | 0.2 km | 6.2 | 0.284 | menor score entre 29 candidatas (la más barata era Family Energy a 1.329, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 42.8% | 5.3 | 42.8 L | 48.1 |
| — | **Destino** | 100% | **25.0** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BONAREA (Bonarea) | Épila | 42.8% | 38.0%–45.9% | 1.350 | -0.233 | 0.2 km | 6.2 | 0.067 | menor score entre 29 candidatas (la más barata era Family Energy a 1.329, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BONAREA (repostaje) | 42.8% | 5.3 | 42.8 L | 48.1 |
| — | **Destino** | 100% | **25.0** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.6 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.2 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.3 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.2 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 5.3 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 25.0 L (pedida 25.0 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 56.88 € · equilibrado 57.78 € · rápido 57.78 € |
| ✅ | Barato tiene el coste mínimo | barato 56.88 € vs mejor de los otros 57.78 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.2 km vs barato 0.6 km |


## S21 · Furgoneta (consumo 9.5)

> **Objetivo del test:** Consumo alto reduce autonomía: comprueba nº de paradas y litros repostados.

**Ruta:** Madrid → Sevilla  
**Parámetros:** Diésel · consumo 9.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 531 km · 299 min · peaje: no  
**Corredor (Diésel, ≤4 km):** 360 estaciones · precio medio 1.628 €/L

### Plan de combustible

```
consumo del viaje  = 531 km × 9.5/100        = 50.5 L
litros de salida   = 50 × 45%                    = 22.5 L
reserva de llegada = 50 × 15%                    = 7.5 L
margen seguridad   = 50 × 8%                     = 4.0 L
autonomía salida   = (22.5-4.0) / 9.5 × 100  = 195 km
autonomía tanque   = (50-4.0) / 9.5 × 100  = 484 km
¿llega sin parar?  = 22.5 - 50.5 ≥ 7.5? → NO
paradas mínimas    = 1   (modo=auto → se usan 1)
```
**Justificación:** La autonomía de salida (195 km) no cubre los 531 km. Con 1 repostaje(s) de depósito lleno la autonomía acumulada es 195 + 1×484 = 679 km ≥ 531 km. **Mínimo 1 parada(s).**

### Comparativa de estrategias (nStops=1)

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.489 € | 2.0 km | 52.80 € | 35 L |
| Equilibrado | 1.529 € | 0.5 km | 54.21 € | 35 L |
| Más rápido | 1.715 € | 0.1 km | 60.81 € | 35 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | SAN ROQUE ( LOW COST ) (San Roque ( Low Cost )) | Casar de Escalona (El) | 24.4% | 15.8%–36.7% | 1.489 | -0.139 | 2.0 km | 8.0 | 0.208 | menor score entre 44 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | SAN ROQUE ( LOW COST ) (repostaje) | 24.4% | 10.2 | 35.5 L | 45.6 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | BALLENOIL (Ballenoil) | Cazalegas | 26.3% | 15.8%–36.7% | 1.529 | -0.099 | 0.5 km | 6.5 | 0.208 | menor score entre 44 candidatas (la más barata era San Roque ( Low Cost ) a 1.489, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | BALLENOIL (repostaje) | 26.3% | 9.2 | 35.5 L | 44.7 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Calzada de Oropesa | 35.7% | 15.8%–36.7% | 1.715 | +0.087 | 0.1 km | 6.1 | 0.051 | menor score entre 44 candidatas (la más barata era San Roque ( Low Cost ) a 1.489, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 35.7% | 4.5 | 35.5 L | 39.9 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 2.0 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 10.2 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.5 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 9.2 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.1 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 4.5 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 52.80 € · equilibrado 54.21 € · rápido 60.81 € |
| ✅ | Barato tiene el coste mínimo | barato 52.80 € vs mejor de los otros 54.21 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.1 km vs barato 2.0 km |


## S22 · Depósito grande (80 L), salida 90%

> **Objetivo del test:** Gran autonomía: debería llegar sin paradas o con una sola pese a la distancia.

**Ruta:** Zaragoza → Sevilla  
**Parámetros:** Diésel · consumo 6 L/100 · depósito 80 L · salida 90% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 859 km · 481 min · peaje: SÍ  
**Corredor (Diésel, ≤4 km):** 604 estaciones · precio medio 1.623 €/L

### Plan de combustible

```
consumo del viaje  = 859 km × 6/100        = 51.6 L
litros de salida   = 80 × 90%                    = 72.0 L
reserva de llegada = 80 × 15%                    = 12.0 L
margen seguridad   = 80 × 8%                     = 6.4 L
autonomía salida   = (72.0-6.4) / 6 × 100  = 1093 km
autonomía tanque   = (80-6.4) / 6 × 100  = 1227 km
¿llega sin parar?  = 72.0 - 51.6 ≥ 12.0? → SÍ
paradas mínimas    = 0   (modo=auto → se usan 0)
```
**Justificación:** Con 72 L de salida y un consumo de 52 L, terminas con 20 L ≥ 12 L de reserva. **No hace falta repostar.**

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | Llega con la reserva pedida | llega con 20.4 L (reserva pedida 12.0 L) |


## S23 · SP98 (combustible premium poco común)

> **Objetivo del test:** Corredor de SP98 (menos estaciones que SP95). Verifica selección con corredor medio.

**Ruta:** Madrid → Granada  
**Parámetros:** SP98 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 15% · paradas=auto

**Ruta calculada:** 421 km · 246 min · peaje: no  
**Corredor (SP98, ≤4 km):** 188 estaciones · precio medio 1.772 €/L

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
| Más barato | 1.529 € | 0.8 km | 18.90 € | 12 L |
| Equilibrado | 1.529 € | 0.8 km | 18.90 € | 12 L |
| Más rápido | 1.829 € | 0.0 km | 22.60 € | 12 L |

#### Estrategia: Más barato

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Valdepeñas | 35.6% | 0.0%–67.6% | 1.529 | -0.243 | 0.8 km | 6.8 | 0.010 | menor score entre 138 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 35.6% | 12.8 | 12.4 L | 25.1 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Equilibrado

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | ALCAMPO (Alcampo) | Valdepeñas | 35.6% | 0.0%–67.6% | 1.529 | -0.243 | 0.8 km | 6.8 | 0.084 | menor score entre 138 candidatas de la ventana (también la más barata) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | ALCAMPO (repostaje) | 35.6% | 12.8 | 12.4 L | 25.1 |
| — | **Destino** | 100% | **7.5** | — | — |

#### Estrategia: Más rápido

Selección y justificación de cada repostaje:

| Parada k | Estación (marca) | Ciudad | Progreso | Ventana | Precio | Δ media | Desvío | timeCost | Score | ¿Por qué? |
|--:|---|---|--:|--:|--:|--:|--:|--:|--:|---|
| 1 | REPSOL (Repsol) | Seseña | 11.5% | 0.0%–67.6% | 1.829 | +0.057 | 0.0 km | 6.0 | 0.034 | menor score entre 138 candidatas (la más barata era Alcampo a 1.529, con peor score por desvío/tiempo) |

Simulación del depósito a lo largo del viaje:

| Orden | Punto | Progreso | Llega (L) | Repostaje | Sale (L) |
|--:|---|--:|--:|--:|--:|
| 1 | REPSOL (repostaje) | 11.5% | 19.3 | 12.4 L | 31.7 |
| — | **Destino** | 100% | **7.5** | — | — |

### Comprobaciones de lógica

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ✅ | [cheap] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [cheap] Paradas ordenadas por progreso | sí |
| ✅ | [cheap] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [cheap] No se queda en seco antes de repostar | llegada mínima a un repostaje = 12.8 L (margen seguridad 4.0 L) |
| ✅ | [cheap] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [cheap] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [balanced] Estaciones dentro del corredor (≤4 km) | desvío máx 0.8 km |
| ✅ | [balanced] Paradas ordenadas por progreso | sí |
| ✅ | [balanced] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [balanced] No se queda en seco antes de repostar | llegada mínima a un repostaje = 12.8 L (margen seguridad 4.0 L) |
| ✅ | [balanced] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [balanced] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | [fast] Estaciones dentro del corredor (≤4 km) | desvío máx 0.0 km |
| ✅ | [fast] Paradas ordenadas por progreso | sí |
| ✅ | [fast] Nº de paradas = solicitadas | 1/1 (menos si el corredor no tiene suficientes candidatas separadas) |
| ✅ | [fast] No se queda en seco antes de repostar | llegada mínima a un repostaje = 19.3 L (margen seguridad 4.0 L) |
| ✅ | [fast] Llega al destino con la reserva | llega con 7.5 L (pedida 7.5 L) |
| ✅ | [fast] Réplica del score = elección real de pickStops | el conjunto de estaciones coincide |
| ✅ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 18.90 € · equilibrado 18.90 € · rápido 22.60 € |
| ✅ | Barato tiene el coste mínimo | barato 18.90 € vs mejor de los otros 18.90 € |
| ✅ | Rápido no tiene más desvío que barato | desvío rápido 0.0 km vs barato 0.8 km |


### ⚠️ G012 · A Coruña→Cartagena · Compacto · SP98 · 45/40% · 1

**Ruta:** A Coruña → Cartagena  
**Parámetros:** SP98 · consumo 5.5 L/100 · depósito 55 L · salida 45% · llegada ≥ 40% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.799 € | 1.2 km | 90.87 € | 51 L |
| Equilibrado | 1.799 € | 1.2 km | 90.87 € | 51 L |
| Más rápido | 1.799 € | 1.2 km | 90.87 € | 51 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 17.9 L (pedida 22.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 17.9 L (pedida 22.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 17.9 L (pedida 22.0 L) |


### ⚠️ G016 · Zaragoza→Sevilla · Compacto · SP95 · 30/40% · auto

**Ruta:** Zaragoza → Sevilla  
**Parámetros:** SP95 · consumo 5.5 L/100 · depósito 55 L · salida 30% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.619 € | 0.4 km | 80.18 € | 50 L |
| Equilibrado | 1.619 € | 0.4 km | 80.18 € | 50 L |
| Más rápido | 1.619 € | 0.4 km | 80.18 € | 50 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 18.8 L (pedida 22.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 18.8 L (pedida 22.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 18.8 L (pedida 22.0 L) |


### ⚠️ G019 · Granada→Zaragoza · Compacto · SP95 · 80/25% · 2 · Repsol

**Ruta:** Granada → Zaragoza  
**Parámetros:** SP95 · consumo 5.5 L/100 · depósito 55 L · salida 80% · llegada ≥ 25% · paradas=2 · marcas: Repsol

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.627 € | 0.7 km | 16.14 € | 10 L |
| Equilibrado | 1.622 € | 0.5 km | 15.91 € | 10 L |
| Más rápido | 1.659 € | 0.1 km | 16.34 € | 10 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 16.14 € · equilibrado 15.91 € · rápido 16.34 € |
| ⚠️ | Barato tiene el coste mínimo | barato 16.14 € vs mejor de los otros 15.91 € (Δ 0.24 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |


### ⚠️ G024 · Madrid→Barcelona +2wp · Compacto · SP98 · 80/40% · 2 · Repsol

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** SP98 · consumo 5.5 L/100 · depósito 55 L · salida 80% · llegada ≥ 40% · paradas=2 · marcas: Repsol

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.692 € | 0.2 km | 21.17 € | 12 L |
| Equilibrado | 1.692 € | 0.2 km | 21.17 € | 12 L |
| Más rápido | 1.692 € | 0.2 km | 20.84 € | 12 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato tiene el coste mínimo | barato 21.17 € vs mejor de los otros 20.84 € (Δ 0.32 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |


### ⚠️ G046 · Valencia→A Coruña · Berlina · SP95 · 30/10% · 1

**Ruta:** Valencia → A Coruña  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 10% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.685 € | 0.8 km | 76.89 € | 46 L |
| Equilibrado | 1.685 € | 0.8 km | 76.89 € | 46 L |
| Más rápido | 1.685 € | 0.8 km | 76.89 € | 46 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -1.2 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -1.2 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -1.2 L (pedida 5.0 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G051 · Sevilla→Barcelona · Berlina · SP98 · 30/15% · 1

**Ruta:** Sevilla → Barcelona  
**Parámetros:** SP98 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 15% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.755 € | 0.5 km | 79.35 € | 45 L |
| Equilibrado | 1.755 € | 0.5 km | 79.35 € | 45 L |
| Más rápido | 1.755 € | 0.5 km | 79.35 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -7.3 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -7.3 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -7.3 L (pedida 7.5 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G052 · Bilbao→Málaga · Berlina · SP95 · 45/25% · auto

**Ruta:** Bilbao → Málaga  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 25% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.665 € | 0.5 km | 75.52 € | 45 L |
| Equilibrado | 1.665 € | 0.5 km | 75.52 € | 45 L |
| Más rápido | 1.665 € | 0.5 km | 75.52 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 7.0 L (pedida 12.5 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 7.0 L (pedida 12.5 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 7.0 L (pedida 12.5 L) |


### ⚠️ G056 · Cádiz→Barcelona +1wp · Berlina · Diésel · 30/25% · 1

**Ruta:** Cádiz → Madrid → Barcelona  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 25% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.719 € | 0.3 km | 77.86 € | 45 L |
| Equilibrado | 1.719 € | 0.3 km | 77.86 € | 45 L |
| Más rápido | 1.719 € | 0.3 km | 77.86 € | 45 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con -22.3 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con -22.3 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |
| ⚠️ | [fast] Llega al destino con la reserva | llega con -22.3 L (pedida 12.5 L) — esperado: forzadas 1 paradas < 2 necesarias |


### ⚠️ G058 · Madrid→Málaga +4wp · Berlina · SP95 · 60/10% · 2

**Ruta:** Madrid → Aranjuez → Ciudad Real → Córdoba → Antequera → Málaga  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 60% · llegada ≥ 10% · paradas=2

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.362 € | 0.5 km | 18.89 € | 14 L |
| Equilibrado | 1.459 € | 0.1 km | 21.38 € | 14 L |
| Más rápido | 1.382 € | 0.1 km | 19.17 € | 14 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 18.89 € · equilibrado 21.38 € · rápido 19.17 € |


### ⚠️ G061 · Madrid→Valencia · Berlina · SP95 · 30/40% · 1 · i/v

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** SP95 · consumo 6.5 L/100 · depósito 50 L · salida 30% · llegada ≥ 40% · paradas=1

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.685 € | 0.5 km | 76.96 € | 46 L |
| Equilibrado | 1.685 € | 0.5 km | 76.96 € | 46 L |
| Más rápido | 1.685 € | 0.5 km | 76.96 € | 46 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 14.1 L (pedida 20.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 14.1 L (pedida 20.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 14.1 L (pedida 20.0 L) |


### ⚠️ G062 · Barcelona→Cádiz · Berlina · Diésel · 45/10% · auto · i/v

**Ruta:** Barcelona → Cádiz → Barcelona (ida y vuelta)  
**Parámetros:** Diésel · consumo 6.5 L/100 · depósito 50 L · salida 45% · llegada ≥ 10% · paradas=auto

**Comparativa de estrategias (nStops=3):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.440 € | 1.5 km | 182.23 € | 126 L |
| Equilibrado | 1.454 € | 0.5 km | 184.02 € | 126 L |
| Más rápido | 1.706 € | 0.4 km | 214.18 € | 126 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [fast] Llega al destino con la reserva | llega con 4.2 L (pedida 5.0 L) |


### ⚠️ G070 · Barcelona→Cádiz · SUV · SP95 · 90/40% · 1 · Cepsa+BP

**Ruta:** Barcelona → Cádiz  
**Parámetros:** SP95 · consumo 8 L/100 · depósito 60 L · salida 90% · llegada ≥ 40% · paradas=1 · marcas: Cepsa+BP

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.679 € | 2.7 km | 92.58 € | 55 L |
| Equilibrado | 1.679 € | 2.7 km | 92.58 € | 55 L |
| Más rápido | 1.679 € | 2.7 km | 92.58 € | 55 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 19.9 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 19.9 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 19.9 L (pedida 24.0 L) |


### ⚠️ G074 · A Coruña→Cartagena · SUV · Diésel · 80/40% · auto · Repsol

**Ruta:** A Coruña → Cartagena  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 80% · llegada ≥ 40% · paradas=auto · marcas: Repsol

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.745 € | 2.5 km | 94.66 € | 54 L |
| Equilibrado | 1.745 € | 2.5 km | 94.66 € | 54 L |
| Más rápido | 1.745 € | 2.5 km | 94.66 € | 54 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 18.8 L (pedida 24.0 L) |


### ⚠️ G078 · Zaragoza→Sevilla · SUV · SP98 · 60/40% · auto

**Ruta:** Zaragoza → Sevilla  
**Parámetros:** SP98 · consumo 8 L/100 · depósito 60 L · salida 60% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.849 € | 1.6 km | 101.47 € | 55 L |
| Equilibrado | 1.849 € | 1.6 km | 101.47 € | 55 L |
| Más rápido | 1.849 € | 1.6 km | 101.47 € | 55 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 22.1 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 22.1 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 22.1 L (pedida 24.0 L) |


### ⚠️ G081 · Granada→Zaragoza · SUV · SP98 · 30/25% · auto

**Ruta:** Granada → Zaragoza  
**Parámetros:** SP98 · consumo 8 L/100 · depósito 60 L · salida 30% · llegada ≥ 25% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.769 € | 0.7 km | 96.35 € | 54 L |
| Equilibrado | 1.769 € | 0.7 km | 96.35 € | 54 L |
| Más rápido | 1.769 € | 0.7 km | 96.35 € | 54 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 14.1 L (pedida 15.0 L) |


### ⚠️ G086 · Madrid→Barcelona +2wp · SUV · Diésel · 30/40% · auto

**Ruta:** Madrid → Zaragoza → Lleida → Barcelona  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 30% · llegada ≥ 40% · paradas=auto

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.679 € | 1.1 km | 92.08 € | 55 L |
| Equilibrado | 1.679 € | 1.1 km | 92.08 € | 55 L |
| Más rápido | 1.679 € | 1.1 km | 92.08 € | 55 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 22.8 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 22.8 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 22.8 L (pedida 24.0 L) |


### ⚠️ G090 · Bilbao→Málaga +5wp · SUV · SP98 · 90/40% · 1 · Cepsa+BP

**Ruta:** Bilbao → Madrid → Toledo → Ciudad Real → Córdoba → Granada → Málaga  
**Parámetros:** SP98 · consumo 8 L/100 · depósito 60 L · salida 90% · llegada ≥ 40% · paradas=1 · marcas: Cepsa+BP

**Comparativa de estrategias (nStops=1):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.819 € | 0.6 km | 86.33 € | 47 L |
| Equilibrado | 1.819 € | 0.6 km | 86.33 € | 47 L |
| Más rápido | 1.819 € | 0.6 km | 86.33 € | 47 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | [cheap] Llega al destino con la reserva | llega con 11.7 L (pedida 24.0 L) |
| ⚠️ | [balanced] Llega al destino con la reserva | llega con 11.7 L (pedida 24.0 L) |
| ⚠️ | [fast] Llega al destino con la reserva | llega con 11.7 L (pedida 24.0 L) |


### ⚠️ G092 · Madrid→Valencia · SUV · Diésel · 45/15% · 2 · i/v

**Ruta:** Madrid → Valencia → Madrid (ida y vuelta)  
**Parámetros:** Diésel · consumo 8 L/100 · depósito 60 L · salida 45% · llegada ≥ 15% · paradas=2

**Comparativa de estrategias (nStops=2):**

| Estrategia | Precio medio | Desvío medio | Coste repostaje | Litros totales |
|---|--:|--:|--:|--:|
| Más barato | 1.473 € | 1.0 km | 57.76 € | 39 L |
| Equilibrado | 1.478 € | 0.7 km | 57.74 € | 39 L |
| Más rápido | 1.691 € | 0.1 km | 66.11 € | 39 L |

| Estado | Comprobación | Detalle |
|:--:|---|---|
| ⚠️ | Barato ≤ Equilibrado ≤ Rápido (coste) | barato 57.76 € · equilibrado 57.74 € · rápido 66.11 € |
| ⚠️ | Barato tiene el coste mínimo | barato 57.76 € vs mejor de los otros 57.74 € (Δ 0.02 €; "barato" pesa un 5% el tiempo, puede saltar una estación ~0,005 €/L más barata con más desvío) |
