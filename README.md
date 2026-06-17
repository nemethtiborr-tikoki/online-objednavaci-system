# Online objednavaci system

Jednoduchy prototyp objednavacieho systemu tovaru pre zakaznikov a administratora.

## Spustenie

Ak mate v systeme nainstalovany Node.js:

```powershell
npm start
```

Ak Node.js nie je v systeme nainstalovany, v prostredi Codexu funguje prilozeny runtime:

```powershell
& 'C:\Users\referent.CORNICO\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

Potom otvorte:

```text
http://localhost:3000
```

## Demo ucty

- Zakaznik: `zakaznik` / `zakaznik123`
- Administrator: `admin` / `admin123`

## Co system obsahuje

- prihlasenie zakaznika a administratora
- objednavkovy formular so zoznamom aktivneho tovaru
- mnozstva v celych kusoch a poznamka k objednavke
- vypocet celkovej hmotnosti objednavky
- historia objednavok pre zakaznika
- zakaznicky profil s firemnymi udajmi, telefonom, menom objednavajuceho a nazvom prevadzky
- administracia tovarovych poloziek
- administracia zakaznikov
- historia objednavok pre administratora
- uvodny admin prehlad so sumarom novych objednavok
- zoznam objednavok v administracii s otvorenim detailu objednavky
- rozbalitelny filter objednavok podla udajov v objednavke
- radenie zoznamu objednavok podla stlpcov
- uprava stavu, poznamky a mnozstiev v objednavke s moznostou zrusit neulozene upravy a zatvorit detail
- tlac objednavky z administracie
- zapis simulovanych e-mailov do suboru `data/emails.log`

## Tovarova polozka

Kazda polozka obsahuje:

- cislo karty
- nazov
- mernu jednotku
- hmotnost
- cenu
- aktivitu polozky

## Zakaznicky profil

Zakaznik si vie upravit:

- firemny nazov
- ICO
- DIC
- IC DPH
- telefonne cislo
- meno objednavajuceho
- nazov prevadzky
- adresu

Administrator vie v casti `Zakaznici` vytvarat novych zakaznikov, upravovat ich udaje a vymazat zakaznicke ucty.

## Stavy objednavky

Nova objednavka automaticky dostane stav `nova objednavka`. Administrator ju potom vie zmenit na:

- spracovava sa
- vybavena

## Poznamka k e-mailom

Tento prototyp zatial neodosiela skutocny e-mail cez SMTP server. Pri vytvoreni objednavky zapise obsah e-mailu pre zakaznika aj administratora do `data/emails.log`. Na realne odosielanie bude potrebne doplnit SMTP udaje vasej e-mailovej schranky alebo firemneho mail servera.
