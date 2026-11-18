import {useEffect} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDownToLine,Check,Download,RefreshCw,X} from 'lucide-react';
import {cancelUpdate,dismissUpdate,mountUpdateService,runUpdateAction,showUpdate,useUpdateSnapshot} from './updateController';
import {useNoticePanel} from './useNoticePanel';
export function updateWords(ru:boolean,phase:string,reason?:string){
 const t=(en:string,ruText:string)=>ru?ruText:en;
 const titles:Record<string,string>={idle:t('AetherFlow updates','Обновления AetherFlow'),checking:t('Checking for updates…','Проверка обновлений…'),current:t('AetherFlow is up to date','Установлена актуальная версия'),available:t('A new version is available','Доступна новая версия'),downloading:t('Downloading update…','Скачивание обновления…'),verifying:t('Download complete. Verifying update…','Скачивание завершено. Проверка обновления…'),downloaded:t('Update is ready to install','Обновление готово к установке'),applying:t('Starting the update…','Запуск обновления…'),cancelled:t('Download paused','Скачивание остановлено'),error:t('Update needs attention','Не удалось завершить обновление')};
 const error=reason==='offline'||reason==='timeout'?t('Check your connection and try again.','Проверьте подключение и повторите попытку.'):reason==='low-disk'?t('Free some space on the application drive, then retry.','Освободите место на диске приложения и повторите попытку.'):reason==='invalid-signature'||reason==='invalid-digest'||reason==='untrusted-host'?t('The package could not be verified. It has not been accepted.','Не удалось проверить подлинность пакета. Он не принят.'):t('You can retry the operation when ready.','Повторите действие, когда будете готовы.');
 return {title:titles[phase]||titles.idle,error};
}
function UpdatePanel({locale,onClose}:{locale:string;onClose:()=>void}){
 const {status,busy,failedAction}=useUpdateSnapshot(),ru=locale==='ru',t=(en:string,r:string)=>ru?r:en,words=updateWords(ru,status.phase,status.reason);
 const loading=!!busy||['checking','downloading','verifying','applying'].includes(status.phase),known=Number.isFinite(status.totalBytes)&&Number(status.totalBytes)>0,percentage=known?Math.min(100,Math.floor(Number(status.receivedBytes||0)/Number(status.totalBytes)*100)):undefined;
 const apply=(event:React.MouseEvent)=>{if(event.detail>1)return;void runUpdateAction('updates:apply')};
 return <article className="update-toast" data-testid="application-update-toast" data-phase={status.phase} aria-busy={loading}>
  <div className={'update-toast-icon'+(loading?' is-loading':'')}>{loading?<span className="activity-dots" aria-hidden="true"><i/><i/><i/></span>:status.phase==='current'||status.phase==='downloaded'?<Check size={20}/>:<Download size={20}/>}</div>
  <div className="update-toast-copy"><strong role="status">{busy==='updates:apply'?t('Preparing to restart…','Подготовка к перезапуску…'):words.title}{status.availableVersion&&['available','downloaded'].includes(status.phase)?` · ${status.availableVersion}`:''}</strong>
   <p>{status.phase==='downloaded'?t('AetherFlow will save pending work, close, and open the installer after you confirm. Active sessions may need to be stopped first.','После подтверждения AetherFlow сохранит изменения, закроется и откроет установщик. Активные сессии может потребоваться остановить.'):status.phase==='available'?t('Download now and choose when to install.','Скачайте сейчас, а время установки выберите сами.'):status.phase==='verifying'?t('Checking the signed package before enabling installation.','Проверяем подписанный пакет перед установкой.'):status.phase==='error'?words.error:status.phase==='downloading'?t('You can keep working while the installer downloads.','Продолжайте работу, пока скачивается установщик.'):status.phase==='current'?t('No action is needed.','Никаких действий не требуется.'):t('The status is also available in Settings → Integrations.','Статус доступен в «Настройки → Интеграции».')}</p>
   {status.phase==='downloading'&&<><div className="update-transfer-track" role="progressbar" aria-label={t('Update download','Загрузка обновления')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><i className={known?'':'indeterminate'} style={known?{transform:`scaleX(${Number(percentage)/100})`}:undefined}/></div><small>{known?`${percentage}% · `:''}{(Number(status.receivedBytes||0)/1048576).toFixed(1)} {t('MB received','МБ получено')}</small></>}
   {status.phase==='error'&&status.message&&<details><summary>{t('Details','Подробности')}</summary><p>{status.message}</p></details>}
   <div className="update-toast-actions">
    {['idle','current'].includes(status.phase)&&<button type="button" className="subtle-button" disabled={loading} onClick={()=>void runUpdateAction('updates:check')}><RefreshCw size={14}/>{t('Check for updates','Проверить обновления')}</button>}
    {status.phase==='available'&&<button className="primary-button" disabled={loading} onClick={event=>{if(event.detail<2)void runUpdateAction('updates:download')}}><ArrowDownToLine size={15}/>{t('Download','Скачать')}</button>}
    {status.phase==='downloaded'&&status.canApply&&<button className="primary-button" disabled={loading} onClick={apply}><RefreshCw size={15}/>{t('Update','Обновить')}</button>}
    {status.phase==='downloaded'&&!status.canApply&&<small>{t('Installation is available in the installed application.','Установка доступна в установленном приложении.')}</small>}
    {(status.phase==='error'||status.phase==='cancelled')&&<button className="primary-button" disabled={loading} onClick={()=>void runUpdateAction(failedAction||(status.availableVersion?'updates:download':'updates:check'))}>{t('Retry','Повторить')}</button>}
    {['downloading','verifying'].includes(status.phase)&&<button className="primary-button" disabled>{status.phase==='verifying'?t('Verifying…','Проверка…'):t('Downloading…','Скачивание…')}</button>}
    {status.phase==='downloading'&&<button className="subtle-button" onClick={()=>void cancelUpdate()}>{t('Cancel','Отменить')}</button>}
    {['available','downloaded'].includes(status.phase)&&<button className="subtle-button" onClick={dismissUpdate}>{t('Later','Позже')}</button>}
   </div>
  </div><button className="update-toast-dismiss" onClick={onClose} aria-label={t('Hide update status','Скрыть статус обновления')}><X size={16}/></button>
 </article>;
}
export function UpdateStatusButton({locale}:{locale:string}){
 const {status,visible}=useUpdateSnapshot(),label=locale==='ru'?'Обновления приложения':'Application updates';
 const {anchor,panel,style,close}=useNoticePanel(visible,dismissUpdate);
 useEffect(()=>dismissUpdate,[]);
 return <div className="notification-anchor" ref={anchor}>
  <button type="button" className="icon-button update-status-trigger" aria-label={label} data-tooltip={label} aria-haspopup="dialog" aria-expanded={visible} aria-controls={visible?'application-update-panel':undefined} onClick={visible?dismissUpdate:showUpdate}><Download size={16}/>{['available','downloaded','error'].includes(status.phase)&&<i/>}</button>
  {visible&&createPortal(<section ref={panel} style={style} id="application-update-panel" className="notification-update-panel" role="dialog" aria-modal="false" aria-label={label} tabIndex={-1}><UpdatePanel locale={locale} onClose={()=>close(true)}/></section>,document.body)}
 </div>;
}
export function UpdateNotifications(){
 useEffect(mountUpdateService,[]);
 return null;
}
