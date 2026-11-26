/* Dedicated messaging worker, not an offline/app-shell cache. Never touch other workers. */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
const config = Object.fromEntries(['apiKey', 'projectId', 'appId', 'messagingSenderId']
  .map(key => [key, params.get(key) || '']));
if (config.apiKey && config.projectId && /^1:\d+:web:.+$/.test(config.appId) && config.messagingSenderId) {
  firebase.initializeApp(config);
  firebase.messaging();
}