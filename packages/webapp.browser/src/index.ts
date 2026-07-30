// @statewalker/webapp.browser — public barrel.
//
// Browser ServiceWorker host binding for the web-app project nature: `hostApp`
// mounts a `webapp.core` SiteHandler behind `HostedSiteBuilder`, and
// `withIsolationHeaders` stamps the cross-origin isolation headers on served
// responses. It also owns the React-free open-command logic (`OpenWebAppCommand`
// + `registerOpenWebApp`) and the shared dock-panel identity (`dock-catalog`) the
// paired `webapp.view.react` `<SiteFrame>` renderer registers against (ADR-0002:
// logic here, React renderer there).

export * from "./dock-catalog.js";
export * from "./host-app.js";
export * from "./isolation-headers.js";
export * from "./open-web-app.js";
