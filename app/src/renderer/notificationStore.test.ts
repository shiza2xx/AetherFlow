import {describe,expect,it} from 'vitest';
import {NOTIFICATION_LIMIT,activeToastEntries,addNotification,clearReadNotifications,dismissNotification,emptyNotifications,expireNotifications,markNotificationRead,unreadNotificationCount,visibleNotificationEntries} from './notificationStore';

describe('session notification history',()=>{
 it('coalesces recent identical notices while keeping the latest actionable detail',()=>{
  let state=emptyNotifications;state=addNotification(state,{message:'Import failed',severity:'error',detail:'first clip failed',code:'CLIP_A'},0,'e0');state=addNotification(state,{message:'Import failed',severity:'error',detail:'second clip failed',code:'CLIP_B'},100,'e1');
  expect(state.entries).toHaveLength(1);expect(state.entries[0].count).toBe(2);expect(state.entries[0].detail).toBe('second clip failed');expect(state.entries[0].code).toBe('CLIP_B');
 });
 it('retains expired history, hides dismissed rows, and clears only acknowledged rows',()=>{
  let state=emptyNotifications;state=addNotification(state,{message:'Saved',severity:'success'},0,'s');state=addNotification(state,{message:'Import failed',severity:'error',detail:'decoder rejected bytes'},1,'e');
  state=expireNotifications(state,6000);expect(state.entries).toHaveLength(2);expect(activeToastEntries(state,6000).map(item=>item.key)).toEqual(['e']);
  state=markNotificationRead(state,'e',6001);expect(visibleNotificationEntries(state)).toHaveLength(2);expect(unreadNotificationCount(state)).toBe(1);
  state=dismissNotification(state,'s',6002);expect(visibleNotificationEntries(state).map(item=>item.key)).toEqual(['e']);expect(unreadNotificationCount(state)).toBe(0);
  state=clearReadNotifications(state);expect(visibleNotificationEntries(state)).toHaveLength(0);expect(state.entries).toHaveLength(0);
 });
 it('evicts successful history to retain a new error at the 100 item limit',()=>{
  let state=emptyNotifications;for(let n=0;n<NOTIFICATION_LIMIT;n++)state=addNotification(state,{message:`Saved ${n}`,severity:'success'},n*6000,`s${n}`);
  state=addNotification(state,{message:'Critical import failure',severity:'error',detail:'bad bytes',code:'IMPORT_FAIL'},700000,'new-error');
  expect(state.entries).toHaveLength(NOTIFICATION_LIMIT);expect(state.entries[0].key).toBe('s1');expect(state.entries.at(-1)?.key).toBe('new-error');expect(state.overflow).toBeNull();expect(unreadNotificationCount(state)).toBe(NOTIFICATION_LIMIT);
 });
 it('keeps bounded truthful overflow for all-error history and allows badge acknowledgement and dismissal',()=>{
  let state=emptyNotifications;for(let n=0;n<NOTIFICATION_LIMIT;n++)state=addNotification(state,{message:`Failure ${n}`,severity:'error'},n,`e${n}`);
  state=addNotification(state,{message:'Final failure detail',severity:'error',detail:'last clip invalid',code:'VIDEO_INVALID'},200,'overflow');
  expect(state.entries).toHaveLength(NOTIFICATION_LIMIT);expect(state.overflow?.severity).toBe('error');expect(state.overflow?.last.detail).toBe('last clip invalid');expect(unreadNotificationCount(state)).toBe(101);
  state=markNotificationRead(state,'overflow',201);expect(unreadNotificationCount(state)).toBe(100);expect(state.overflow?.readAt).toBe(201);
  state=dismissNotification(state,'overflow',202);expect(state.overflow?.dismissedAt).toBe(202);expect(unreadNotificationCount(state)).toBe(100);state=clearReadNotifications(state);expect(state.overflow).toBeNull();
 });
 it('expires errors after eight seconds while retaining their diagnostics in history',()=>{
  const state=addNotification(emptyNotifications,{message:'Import failed',severity:'error',detail:'Invalid model'},0,'e');
  expect(activeToastEntries(state,7999)).toHaveLength(1);
  const expired=expireNotifications(state,8000);
  expect(activeToastEntries(expired,8000)).toEqual([]);
  expect(visibleNotificationEntries(expired)[0].detail).toBe('Invalid model');
 });
 it('keeps one history entry per persisted result and suppresses in-app display for desktop delivery',()=>{
  const item={message:'Images saved',description:'Saved for review: 1',severity:'success' as const,showInApp:false};
  let state=addNotification(emptyNotifications,item,0,'batch-a');
  state=addNotification(state,item,1,'batch-a');
  state=addNotification(state,item,2,'batch-b');
  expect(visibleNotificationEntries(state).map(entry=>entry.key)).toEqual(['batch-a','batch-b']);
  expect(activeToastEntries(state,2)).toEqual([]);
 });
});
