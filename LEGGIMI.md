# Quaderno — guida

Quaderno è un'app per note, taccuini, attività e promemoria.
- **Sui PC Windows** è un programma, `Quaderno.exe`: si apre con un doppio clic, nella sua finestra.
- **Sul telefono** si apre da un indirizzo web e si aggiunge alla schermata Home.

**Le note vengono salvate nel tuo OneDrive**, nella cartella **App › Quaderno**, e sono le stesse su tutti i dispositivi. Non passano da altri server.

Finché i passi qui sotto non sono fatti, Quaderno funziona solo con **"Usa solo su questo dispositivo"**: le note restano su quel PC.

## Le cartelle

```
QUADERNO\
  Quaderno-app\   l'app vera e propria (sono i suoi file che vanno su GitHub)
  exe\            il necessario per costruire Quaderno.exe (build.ps1, Quaderno.cs, prove)
  dist\           Quaderno.exe, pronto da usare
  docs\           progetto e piano di lavoro
```

---

## Preparazione (una volta sola)

Servono tre passi:
1. mettere l'app online per il telefono, con GitHub Pages (gratis);
2. registrare l'app presso Microsoft, per poter accedere a OneDrive (gratis);
3. scrivere il codice ricevuto da Microsoft in `config.js` e ricostruire l'exe.

### 1. Metti online la versione per il telefono (GitHub Pages)

1. Crea un account gratuito su <https://github.com/signup> (se non ce l'hai già). Il nome utente che scegli finisce nell'indirizzo del sito.
2. In alto a destra: **+** › **New repository**.
   - **Repository name**: `quaderno`
   - Visibilità: **Public**. Con l'account gratuito le pagine web funzionano solo così. Pubblico è solo il programma: le tue note non sono qui.
   - Clicca **Create repository**.
3. Nella pagina del repository clicca il link **uploading an existing file**.
4. Apri la cartella `Quaderno-app` in Esplora file, seleziona **tutto il suo contenuto** (Ctrl+A: i file e la cartella `icons`) e trascinalo nella pagina di GitHub. Non trascinare la cartella `Quaderno-app` stessa.
5. Aspetta che compaiano tutti i file, poi in fondo clicca **Commit changes**.
6. Vai su **Settings** › **Pages** (menu a sinistra). In **Branch** scegli `main` e la cartella `/ (root)`, poi **Save**.
7. Dopo 1–2 minuti il sito è online a `https://TUONOME.github.io/quaderno/`, dove `TUONOME` è il tuo nome utente GitHub.
8. **Annota l'indirizzo**, con la barra finale: serve al passo 2.
   Maiuscole e minuscole contano: se il repository si chiama `Quaderno`, l'indirizzo è `…github.io/Quaderno/`, e con `quaderno` minuscolo si ottiene "404". Vale anche sul telefono, dove la tastiera spesso cambia la prima lettera.

Online va solo il programma. Le note non sono lì.

### 2. Registra l'app presso Microsoft

1. Vai su <https://entra.microsoft.com> e accedi con **lo stesso account Microsoft del tuo OneDrive**.
   - Microsoft potrebbe chiederti di creare prima un account Azure gratuito. Durante la verifica può chiedere una carta di credito, ma per questo uso non si paga nulla.
2. Menu a sinistra: **Applicazioni** › **Registrazioni app** › **Nuova registrazione**.
3. Compila:
   - **Nome**: `Quaderno`. È anche il nome della cartella che comparirà in OneDrive (App › Quaderno).
   - **Tipi di account supportati**: *Account in qualsiasi directory organizzativa e account Microsoft personali*.
   - **URI di reindirizzamento**: scegli la piattaforma **Applicazione a pagina singola (SPA)** e scrivi `http://localhost:47213/`. Questo indirizzo serve a `Quaderno.exe`.
4. Clicca **Registra**.
5. Nella pagina che si apre copia l'**ID applicazione (client)**: è un codice come `1a2b3c4d-....`.
6. Vai su **Autenticazione** › nella sezione *Applicazione a pagina singola* clicca **Aggiungi URI**. Incolla l'indirizzo di GitHub del passo 1 (es. `https://TUONOME.github.io/quaderno/`), poi **Salva**.
   Alla fine devono esserci **due** indirizzi: `http://localhost:47213/` e quello di GitHub.
7. Vai su **Autorizzazioni API** › **Aggiungi un'autorizzazione** › **Microsoft Graph** › **Autorizzazioni delegate**. Cerca e spunta **Files.ReadWrite.AppFolder** e **Calendars.Read**, poi **Aggiungi autorizzazioni**.
   - Con **Files.ReadWrite.AppFolder** Quaderno vede **solo la sua cartella**, non il resto del tuo OneDrive.
   - Con **Calendars.Read** Quaderno può **leggere** il calendario di Outlook, per mostrarlo nel Calendario e nella Home. Non può modificarlo.

### 3. Inserisci il codice e aggiorna exe e GitHub

1. Apri `Quaderno-app\config.js` e incolla il codice tra le virgolette:
   ```js
   clientId: "1a2b3c4d-....",
   ```
2. Ricostruisci l'exe:
   1. **Chiudi Quaderno**, se è aperto: un exe in uso non si può sostituire.
   2. Apri la cartella `QUADERNO` in Esplora file. Clicca nella barra dell'indirizzo in alto, scrivi `powershell` e premi **Invio**: si apre una finestra blu o nera.
   3. Scrivi questo comando e premi **Invio**:
      ```powershell
      powershell -ExecutionPolicy Bypass -File exe\build.ps1
      ```
   4. Quando compare *"Creato …\dist\Quaderno.exe"*, il nuovo exe contiene il codice. Puoi chiudere la finestra.
3. Aggiorna GitHub. Nel repository `quaderno` clicca **Add file › Upload files**, trascina il file `config.js` e clicca **Commit changes**. Dopo un minuto il sito usa il nuovo codice.
4. Apri Quaderno e clicca **Accedi con Microsoft**. La prima volta Microsoft chiede il consenso e mostra "editore non verificato": è normale per un'app personale, puoi accettare.

> Ogni volta che cambi qualcosa in `Quaderno-app`, ripeti i punti 2 e 3, caricando su GitHub i file cambiati: l'exe contiene una copia dei file, e GitHub pure.

---

## Usarla

### Sui PC Windows

- Fai doppio clic su `dist\Quaderno.exe`. Si apre la finestra di Quaderno; chiudendola, Quaderno si chiude.
- **Su altri PC**: la cartella `QUADERNO` è già dentro OneDrive, quindi su ogni PC dove accedi a OneDrive trovi `QUADERNO\dist\Quaderno.exe`. Non serve installare nulla. Per comodità puoi creare un collegamento sul desktop (clic destro sull'exe › *Mostra altre opzioni › Invia a › Desktop*).
  Se invece copi l'exe in un'altra cartella, ricordati di ricopiarlo ogni volta che lo ricostruisci: la copia non si aggiorna da sola.
- **La prima volta su un PC** Windows può mostrare *"Windows ha protetto il PC"*, perché l'exe non è firmato. Clicca **Ulteriori informazioni › Esegui comunque**.
- Serve Microsoft Edge, che è già presente in ogni Windows 10 e 11. Quaderno usa un profilo di Edge tutto suo, separato dal tuo browser.
- Se compare *"la porta 47213 è già usata da un altro programma"*: un altro programma occupa l'indirizzo di Quaderno. Chiudilo, o riavvia il PC.

### Sul telefono

Apri l'indirizzo di GitHub (`https://TUONOME.github.io/quaderno/`), accedi con Microsoft, poi:
- **Android (Chrome)**: menu ⋮ › *Installa app* oppure *Aggiungi a schermata Home*.
- **iPhone/iPad (Safari)**: pulsante *Condividi* › *Aggiungi alla schermata Home*.

### Su un computer non tuo

Quando hai finito usa **menu del tuo nome › Esci**: la copia delle note su quel computer viene cancellata.

## Portare le note

- **Da Evernote**:
  1. Nell'app desktop di Evernote: clic destro sul taccuino › *Esporta* › formato **ENEX**.
  2. In Quaderno: **Nuovo › Importa da Evernote** e scegli i file .enex.

  Ogni file diventa un taccuino. Vengono importati anche immagini, allegati, liste di controllo, tag e promemoria.
- **Dalla versione di Quaderno su Claude**:
  1. Apri Quaderno su Claude e usa *menu del tuo nome › Backup completo con immagini (.json)*. Con molte immagini ci vuole qualche minuto: lascia la pagina aperta finché compare "Backup salvato".
  2. Salva il file, per esempio in OneDrive.
  3. Qui usa *menu del tuo nome › Ripristina da backup* e scegli quel file.

  Passano testo, taccuini, attività, promemoria, **immagini e allegati**: le immagini finiscono nella cartella `files` di OneDrive.
  Un backup fatto prima di novembre 2026 (voce *Backup completo (.json)*) non contiene le immagini: al loro posto compare *[Immagine … non inclusa nel backup]*. In quel caso rifai il backup con la nuova voce.

## Dove sono i dati in OneDrive

In `OneDrive › App › Quaderno` (su alcuni account: `Apps › Quaderno`):

| Cartella | Contenuto |
|---|---|
| `items` | I dati dell'app: un file per ogni nota, taccuino, attività, evento. **Non modificarli a mano.** |
| `files` | Immagini e allegati delle note. |
| `Leggibili` | Una pagina `.html` per ogni nota, divisa per taccuino: si apre con un doppio clic, anche senza Quaderno. Si può disattivare dal menu del tuo nome. |

Ogni dispositivo tiene anche una copia delle note, così Quaderno si apre subito e funziona senza internet. Sui PC questa copia sta in `%LOCALAPPDATA%\Quaderno`.
Le modifiche fatte offline vengono inviate a OneDrive appena torna la connessione. Se la stessa nota viene modificata su due dispositivi, vale la modifica più recente.

## Regalarla

Mandi `Quaderno.exe` e l'indirizzo di GitHub. Chi li usa accede con il **proprio** account Microsoft, e le sue note finiscono nel **suo** OneDrive: tu non vedi le sue, lui non vede le tue.
Gli account di lavoro o di scuola potrebbero richiedere il permesso del loro amministratore.

## Cosa non c'è rispetto alla versione su Claude

- **Assistente**: funziona solo dentro Claude.
- **Spazi condivisi**: servirebbe un server comune.

E al contrario, il **calendario di Outlook** c'è solo qui: la versione su Claude non accede al tuo account Microsoft.

## Note vocali

- **Nuovo › Nota vocale…** crea una nota nuova con una registrazione; **⋯ › Registra una nota vocale…** la aggiunge alla nota aperta.
- La prima volta il PC o il telefono chiede il permesso di usare il microfono.
- La registrazione (fino a 15 minuti) è un allegato come gli altri: sta sul dispositivo e in OneDrive (cartella `files`). Nella nota compare come "🎤 Nota vocale · durata": un clic la fa ascoltare. Nelle copie leggibili `.html` c'è il lettore audio.

## Calendario di Outlook e meteo

- **Calendario di Outlook**: con l'accesso Microsoft, gli appuntamenti del tuo calendario Outlook compaiono nel Calendario e nella Home di Quaderno, in sola lettura: Quaderno non li modifica. Gli eventi che crei in Quaderno restano in Quaderno.
  - La prima volta, nel Calendario compare **Collega il calendario Outlook**: Microsoft chiede il permesso di leggere il calendario, una volta sola.
  - **Cambiare o scollegare l'account del calendario**: menu del tuo nome › **Calendario Outlook…** (oppure **Account…** in cima al Calendario). Puoi collegare il calendario di **qualsiasi account Microsoft**, anche diverso da quello delle note su OneDrive: un account alla volta, scelto su ogni dispositivo. Le note restano sempre sull'account di OneDrive.
    - **Collega un altro account…**: Microsoft ti fa scegliere l'account; da quel momento vedi i suoi appuntamenti.
    - **Usa l'account di OneDrive**: torna al calendario dello stesso account delle note.
    - **Scollega**: gli appuntamenti di Outlook spariscono da Quaderno su questo dispositivo (Outlook non viene toccato).
  - Funziona anche se usi Quaderno **solo su questo dispositivo**, senza OneDrive.
  - Circa una volta al giorno Microsoft chiede di rinnovare l'accesso: Quaderno lo fa da solo; se non ci riesce, nel Calendario compare **Collega il calendario**.
- **Meteo**: in alto a destra nella Home. La prima volta scegli la città; cliccandolo vedi le previsioni dei prossimi giorni o cambi città. I dati arrivano da Open-Meteo, un servizio gratuito che riceve solo la città scelta.

## Buono a sapersi

- **Notifiche dei promemoria**: sul PC arrivano mentre la finestra di Quaderno è aperta. Su iPhone solo con l'app aggiunta alla schermata Home. In ogni caso compaiono anche dentro l'app.
- **Accesso Microsoft**: ogni tanto viene rinnovato da solo con un breve passaggio sulla pagina Microsoft. Se lo stato in basso a sinistra dice "Accedi di nuovo per sincronizzare", cliccalo.
- **Copia locale**: Safari su iPhone può cancellarla se non apri l'app per settimane. Le note restano comunque in OneDrive e si ricaricano al primo accesso.

## File dell'app

In `Quaderno-app`:
- `index.html` — pagina principale
- `app.css` — aspetto
- `app.js` — funzioni dell'app
- `cloud.js` — accesso Microsoft e salvataggio in OneDrive
- `config.js` — impostazioni, cioè il codice Microsoft
- `sw.js` — funzionamento offline e notifiche
- `manifest.webmanifest` e `icons/` — installazione come app

In `exe`:
- `Quaderno.cs` — il programma per Windows: offre l'app su `http://localhost:47213/` e la apre in una finestra di Edge
- `build.ps1` — costruisce `dist\Quaderno.exe` con dentro i file di `Quaderno-app`
- `test-server.ps1`, `test-launch.ps1` — prove automatiche dell'exe
