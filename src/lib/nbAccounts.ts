// NB accounts are fetched live from the n8n `nb_accounts` datatable via
// PUBLIC_WEBHOOK_NB_ACCOUNTS_LIST_URL → see useAppStore.fetchNbAccounts and
// useAppStore.nbAccountsList. The frontend deliberately does NOT bundle the
// list — 400+ entries would slow HMR and freeze the Combobox on open.
export interface NbAccount {
  name: string;
  id: string;
}
