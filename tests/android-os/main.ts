import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import { setupReactQueryNativeAdapter } from "@/lib/reactQueryNativeAdapter";

const ACTIVE_QUERY_COUNT = 30;
const stateNode = document.querySelector<HTMLElement>("#test-state")!;
const pingNode = document.querySelector<HTMLElement>("#ping-state")!;
const logNode = document.querySelector<HTMLElement>("#event-log")!;

let refetchCount = 0;
let pingCount = 0;
let resumeCount = 0;
let backgroundCount = 0;
let networkEventCount = 0;
let ready = false;

const log = (message: string) => {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(`[ANDROID_OS_TEST] ${line}`);
  logNode.textContent = `${line}\n${logNode.textContent ?? ""}`.slice(0, 4000);
};

const render = () => {
  const text = [
    ready ? "ANDROID_OS_READY" : "ANDROID_OS_BOOTING",
    `ACTIVE=${ACTIVE_QUERY_COUNT}`,
    `REFETCH_COUNT=${refetchCount}`,
    `ONLINE=${onlineManager.isOnline()}`,
    `RESUME_COUNT=${resumeCount}`,
    `BACKGROUND_COUNT=${backgroundCount}`,
    `NETWORK_EVENT_COUNT=${networkEventCount}`,
  ].join(" ");
  stateNode.textContent = text;
  document.title = text;
  console.log(`[ANDROID_OS_TEST_STATE] ${text}`);
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

const originalRefetch = queryClient.refetchQueries.bind(queryClient);
queryClient.refetchQueries = ((...args: Parameters<typeof originalRefetch>) => {
  refetchCount += 1;
  render();
  return originalRefetch(...args);
}) as typeof queryClient.refetchQueries;

const observers = Array.from({ length: ACTIVE_QUERY_COUNT }, (_, index) => {
  const queryKey = [index < 18 ? "inbox" : index < 24 ? "schedule" : "media", "android-os", index];
  queryClient.setQueryData(queryKey, { synthetic: true, index });
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => ({ synthetic: true, index }),
    staleTime: Infinity,
  });
  observer.subscribe(() => {});
  return observer;
});

void observers;
setupReactQueryNativeAdapter(queryClient);
onlineManager.subscribe(render);

void App.addListener("appStateChange", ({ isActive }) => {
  if (isActive) resumeCount += 1;
  else backgroundCount += 1;
  log(`appStateChange isActive=${isActive}`);
  render();
});

void Network.addListener("networkStatusChange", ({ connected }) => {
  networkEventCount += 1;
  log(`networkStatusChange connected=${connected}`);
  render();
});

document.querySelector<HTMLButtonElement>("#ping")!.addEventListener("click", () => {
  pingCount += 1;
  pingNode.textContent = `PING_COUNT=${pingCount}`;
  log(`ping=${pingCount}`);
});

void Network.getStatus().then(({ connected }) => {
  onlineManager.setOnline(connected);
  ready = true;
  log(`ready connected=${connected}`);
  render();
});

render();
