/* Impostazioni di Quaderno.
   clientId: l'"ID applicazione (client)" che Microsoft ti dà quando registri l'app
   (vedi LEGGIMI.md, passi 2 e 3). Non è un segreto: può stare in un file pubblico.
   Dopo averlo cambiato, ricostruisci l'exe (exe\build.ps1) e ricarica questo file su GitHub. */
window.QUADERNO_CONFIG = {
  clientId: "",
  // "common" accetta account Microsoft personali (Outlook, Hotmail, Live) e di lavoro o scuola.
  authority: "https://login.microsoftonline.com/common",
};
