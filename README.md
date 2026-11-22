# STAHLFALKE – Rettung & Angriff

Hubschrauber-Actionspiel im Browser. Du fliegst aus der **Cockpit-Perspektive** mit Live-Instrumenten. Die Einsätze im Retro-Stil mischen **Rettung** (Personen mit der Winde bergen) und **Kampf** (MG und Raketen gegen Flak, Panzer, SAM-Stellungen und feindliche Hubschrauber).

Das Spiel läuft auf **PC (Tastatur/Maus)**, mit **Controller** (Xbox/PlayStation, Gamepad API) und auf dem **Handy mit Neigungssteuerung**.

## Starten

Es gibt keinen Build-Schritt. Den Ordner einfach über einen Webserver ausliefern:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

**Handy:** Browser erlauben den Neigungssensor nur über **HTTPS**. Am einfachsten über GitHub Pages veröffentlichen (Settings → Pages → Branch wählen) und die Seite dann am Handy öffnen. Querformat verwenden.

## Steuerung

| Aktion | Tastatur/Maus | Controller | Handy |
|---|---|---|---|
| Vor/zurück, seitlich | W/S, A/D | rechter Stick | Handy neigen |
| Drehen | Q/E | linker Stick ↔ | linker Stick ↔ |
| Steigen/Sinken | Leertaste·Shift / C·Strg | linker Stick ↕ | linker Stick ↕ |
| Maschinengewehr | Linksklick / J | RT | MG |
| Raketen | Rechtsklick / K | LT / RB | RAK |
| Flares | G | LB / B | FLR |
| Ansicht Cockpit/Außen | V | Y | 👁 |
| Pause | Esc / P | Start | II |
| Neigung kalibrieren | – | – | ⟲ NULL |

## Einsätze

1. **Bergung am See**: vier Schiffbrüchige von einer Insel holen
2. **Konvoi stoppen**: LKW-Konvoi samt Flak-Schutz zerstören
3. **Abgeschossen**: Crew unter Feuer retten, feindlicher Heli taucht auf
4. **Flak-Gürtel**: Radarstation und SAM-Stellungen ausschalten (Flares!)
5. **Operation Sturmvogel**: Festung stürmen, sechs Geiseln befreien

So funktioniert die Rettung: Dem farbigen Rauch folgen, tief (unter 20 m) und langsam darüber schweben, bis die Winde alle an Bord hat. Danach auf dem **H** der Basis landen. Dort wird der Hubschrauber auch repariert und aufmunitioniert.

## Technik

- Three.js (WebGL), liegt in `lib/` bei, kein CDN nötig
- Alles ist prozedural erzeugt: Gelände, Texturen, Himmel und Sound (WebAudio). Es gibt keine externen Assets.
- Grafikstufen Hoch/Mittel/Niedrig (Schatten, Bloom, Vegetation). Mobilgeräte starten automatisch mit „Niedrig“.
- URL-Parameter für Tests: `?q=high|medium|low`, `?all` (alle Einsätze freischalten), `?god` (unverwundbar)

```
src/main.js      Spielschleife, Menüs, Rendering
src/world.js     Gelände, Himmel, Wasser, Vegetation, Basis, Dorf
src/player.js    Flugphysik, Waffen, Kameras
src/cockpit.js   3D-Cockpit mit Live-Instrumenten
src/input.js     Tastatur, Maus, Gamepad, Touch, Neigungssensor
src/enemies.js   Flak, Panzer, LKW, SAM, Bauwerke, Feind-Hubschrauber
src/missions.js  Einsätze und Rettungslogik
src/weapons.js   Geschosse, Raketen, Lenkflugkörper, Flares
src/effects.js   Partikel (Feuer, Rauch, Funken), Leuchtspur
src/hud.js       HUD, Radar, Zielmarkierungen
src/audio.js     Synthetischer Sound
```
