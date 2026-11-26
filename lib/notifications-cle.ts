/* Clé PUBLIQUE « VAPID » d'AgendIA (norme web push).
   Le navigateur la reçoit au moment où l'on active les rappels ; elle lui permet de
   vérifier que les notifications viennent bien d'AgendIA. Elle n'a rien de secret
   (comme la clé publique d'un cadenas) : la clé privée assortie, elle, n'est que sur
   le serveur Vercel (variable d'environnement VAPID_CLE_PRIVEE).                   */
export const VAPID_CLE_PUBLIQUE = "BAQG-4flzoFM70sqtWROQpACHN8fZ2frkZTsBuujEQ3l0Dhc3yHPXmq7160iegla-OAH6-de6NnxLkYzrn8ufMc";
