import {appInfo,openSources} from "../app-info";
export default function AppInfo(){
 return <div className="app-about"><dl className="app-info-details"><div><dt>개발자</dt><dd>{appInfo.developer}</dd></div><div><dt>앱 버전</dt><dd>{appInfo.version}</dd></div></dl><h3>오픈소스</h3><dl className="open-source-list">{openSources.map(item=><div key={item.label}><dt>{item.label}</dt><dd><span>{item.name}</span><small>{item.detail}</small></dd></div>)}</dl></div>;
}
