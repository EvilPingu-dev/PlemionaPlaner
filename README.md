# Planer Akcji – Plemiona

Lokalny planer akcji dla graczy Plemion (Tribal Wars). Działa jako aplikacja webowa w przeglądarce, dane zapisywane są wyłącznie na Twoim komputerze – nic nie trafia do żadnego serwera.

## Co potrafi

- **Rozpiska ataków** – przydziela wioski do celów, oblicza czasy wysyłki dla OFFów i szlachciców
- **Timeline** – wizualizacja kolejności uderzeń
- **Walidator** – sprawdza luki, konflikty i brakujące ataki
- **Wiadomości** – generuje gotowe wiadomości PW per gracz
- **Forum** – BBCode do wklejenia na forum plemi
- **Status akcji** – zaznaczanie kto wysłał / kto olał, BBCode z zastępczymi wioskami
- **CSV export** – pełna rozpiska do Excela
- **Backup / Restore** – zapis i wczytanie stanu planera

---

## Szybki start (Windows)

### Metoda 1 – przez `start.bat` (najprościej)

1. Pobierz lub sklonuj to repozytorium
2. Wypakuj gdziekolwiek (np. `C:\PlanerAkcji`)
3. Kliknij dwukrotnie **`start.bat`**
   - Przy pierwszym uruchomieniu automatycznie instaluje `uv` (menedżer pakietów, ~10 s)
   - Pobiera wymagane biblioteki Python
   - Otwiera przeglądarkę na `http://127.0.0.1:5000`
4. Zostaw czarne okno otwarte – to jest serwer. Zamknij je gdy skończysz.

> **Wymagania:** Windows 10/11, połączenie z internetem przy pierwszym uruchomieniu. Python **nie jest** wymagany.

### Metoda 2 – ręcznie (Linux / macOS / zaawansowani)

Wymagane: Python ≥ 3.12 i [`uv`](https://docs.astral.sh/uv/getting-started/installation/).

```bash
git clone https://github.com/<twoj-nick>/PlemionaPlaner
cd PlemionaPlaner
uv run python main.py
```

Otwórz `http://127.0.0.1:5000` w przeglądarce.

---

## Dane i prywatność

Wszystkie dane (wioski, cele, rozpiska) zapisywane są lokalnie w folderze `data/` jako pliki JSON. Aplikacja nie wysyła żadnych danych na zewnątrz – jedynym wyjątkiem są zapytania do **publicznego API Plemion** (`plXXX.plemiona.pl`) przy imporcie mapy wiosek.

---

## Struktura projektu

```
main.py               – punkt startowy
start.bat             – skrypt uruchomieniowy dla Windows
app/
  __init__.py         – fabryka aplikacji Flask
  planner.py          – logika planowania ataków
  parser.py           – parsowanie danych z Plemion
  generator.py        – generowanie wiadomości i BBCode
  storage.py          – ścieżki plików i zapis JSON
  routes/             – endpointy API (podział na moduły)
  templates/          – HTML (index.html)
  static/
    css/              – style
    js/               – logika frontendowa
data/                 – dane użytkownika (auto-tworzone, nie commitować!)
```

---

## Rozwój lokalny

```bash
uv run python main.py   # tryb deweloperski, hot-reload włączony
```

---

## Licencja

Do użytku prywatnego / wewnątrz-plemiennego. Nie do dystrybucji komercyjnej.
