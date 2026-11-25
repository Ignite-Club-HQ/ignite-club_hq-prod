function s(e,r){if(e.kind==="broadcast")return!0;if(e.kind!=="message_chat")return!1;const u=e.club||e.related_id?.[0]||null;return!u||!r?!1:u===r}export{s as isIcpBroadcastChatNotification};
