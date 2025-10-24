# Kick TTS Reader (Windows) - @retconned/kick-js wersja
Dziala na publicznym czacie Kick bez tokenow. Uzytkownik wpisuje tylko nazwe kanalu.

## Start (dev)
```bash
npm install
npm run start
```
Wpisz nazwe kanalu -> **Start**.

## Build do jednego .EXE
```bash
npm run build:win
```
Artefakty w `dist/` (portable EXE + NSIS).

## Audio do Streamlabs
Domyslnie „Dzwiek systemu" -> dodaj **Desktop Audio**. Dla osobnego suwaka uzyj VB-Audio Virtual Cable.

## Uwaga
Jesli npm narzeka na wersje paczki, zaktualizuj wpis w `package.json` do najnowszej dostepnej: `"@retconned/kick-js": "*"`, a potem `npm install`.

npm run build:portable