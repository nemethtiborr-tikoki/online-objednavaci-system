# Online objednavaci system

Objednavacia aplikacia pre zakaznikov a administratora. Produkcne data uklada do PostgreSQL databazy (odporucany Neon) a aplikacia moze bezat na Renderi.

## Poziadavky

- Node.js 22 alebo novsi
- PostgreSQL databaza
- pnpm

## Premenne prostredia

Podla `.env.example` nastavte najma:

- `DATABASE_URL` - PostgreSQL connection string z Neonu
- `ADMIN_PASSWORD` - pociatocne heslo administratora, minimalne 10 znakov
- `ADMIN_USERNAME`, `ADMIN_EMAIL`, `OWNER_EMAIL`, `COMPANY_NAME`
- `NODE_ENV=production` - zapne bezpecny session cookie cez HTTPS

`ADMIN_PASSWORD` sa pouzije iba pri vytvoreni prvej databazy. Heslo sa uklada ako scrypt hash, nie v citatelnom tvare.

## Lokalny start

```powershell
pnpm install
$env:DATABASE_URL="postgresql://..."
$env:ADMIN_PASSWORD="dlhe-jedinecne-heslo"
pnpm start
```

Aplikacia bude dostupna na `http://localhost:3000`.

## Prenos existujucej SQLite databazy do Neonu

Migracia cielovu PostgreSQL databazu vymaze a nahradi obsahom `data/app.sqlite`. Pred spustenim preto skontrolujte `DATABASE_URL`.

```powershell
$env:DATABASE_URL="postgresql://...neon.tech/...?..."
pnpm run migrate:neon -- --confirm
```

Migracia prenesie nastavenia, pouzivatelov, tovary, objednavky a polozky objednavok. Povodne hesla pri prenose automaticky zahashuje.

## Render

Repozitar obsahuje `render.yaml`. V nastaveniach Renderu pridajte tajne premenne:

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `ADMIN_EMAIL`
- `OWNER_EMAIL`
- `COMPANY_NAME`

Build command je `pnpm install --frozen-lockfile`, start command `pnpm start` a kontrolna adresa `/api/health`.

## Kontroly

```powershell
pnpm run check
pnpm test
```

## Poznamka k e-mailom

Aplikacia zatial iba zapisuje simulovany e-mail do `data/emails.log`. Na skutocne odosielanie treba doplnit SMTP alebo transakcnu e-mailovu sluzbu.
