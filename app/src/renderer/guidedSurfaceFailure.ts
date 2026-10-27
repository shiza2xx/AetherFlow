import type {Locale} from '../shared/i18n';

const tr=(locale:Locale,en:string,ru:string)=>locale==='ru'?ru:en;
const groups:Record<string,[string,string]>={
 head:['head','голова'],hair:['hair','волосы'],upper_body:['upper body','верх тела'],
 lower_body:['lower body','низ тела'],accessories:['accessories','аксессуары'],
};
const operationContext=(locale:Locale,operation:string)=>({
 'inventory':tr(locale,'Stage 8 · Prepare component groups','Этап 8 · Подготовка групп компонентов'),
 'prepare-groups':tr(locale,'Stage 8 · Prepare component groups','Этап 8 · Подготовка групп компонентов'),
 'assemble-returns':tr(locale,'Stage 10 · Receive textured groups','Этап 10 · Возврат текстурированных групп'),
 'rig-source':tr(locale,'Stage 11 · Export rig source','Этап 11 · Экспорт модели для рига'),
 'restore-rig-materials':tr(locale,'Stage 13 · Review returned rig','Этап 13 · Проверка возвращённого рига'),
}[operation]||tr(locale,'Guided surface operation','Операция с поверхностью в процессе'));

export function surfaceFailureMessage(locale:Locale,failure:any){
 const code=String(failure?.code||'SURFACE_OPERATION_FAILED'),operation=String(failure?.operation||'surface'),groupKey=Array.isArray(failure?.group)?failure.group[0]:failure?.group,group=groupKey?groups[String(groupKey)]:undefined;
 const groupText=group?tr(locale,group[0],group[1]):groupKey?String(groupKey):'';
 const namedGroup=groupText?tr(locale,`Group “${groupText}” · `,`Группа «${groupText}» · `):'';
 let cause:string,recovery:string;
 switch(code){
  case 'ASSEMBLY_ALREADY_ACCEPTED_USE_HEAD_FIT':cause=tr(locale,'The textured assembly is already accepted and remains unchanged.','Текстурированная сборка уже принята и остаётся без изменений.');recovery=tr(locale,'Continue with head fitting to create and inspect a fitted-assembly candidate.','Продолжите подгонку головы, чтобы создать и осмотреть кандидата fitted-assembly.');break;
  case 'SURFACE_FACE_COUNT_MISMATCH':cause=tr(locale,'The returned group has a different triangle count from its saved baseline.', 'В возвращённой группе отличается число треугольников от базовой модели.');recovery=tr(locale,'Check that the correct group was exported and that its topology still matches the saved baseline; do not assemble or accept this result.', 'Проверьте, что экспортирована нужная группа и её топология совпадает с базовой моделью; не собирайте и не принимайте этот результат.');break;
  case 'SURFACE_FACE_WINDING_MISMATCH':cause=tr(locale,'At least one matching triangle has reversed winding.', 'У одного или нескольких соответствующих треугольников обратный порядок вершин.');recovery=tr(locale,'Inspect face direction in this return and re-export it with the saved surface orientation.', 'Проверьте направление граней в этом возврате и экспортируйте его с исходной ориентацией поверхности.');break;
  case 'SURFACE_FACE_CORRESPONDENCE_MISSING':cause=tr(locale,'A saved triangle has no matching face within the approved tolerance.', 'Для сохранённого треугольника не найдена соответствующая грань в установленном допуске.');recovery=tr(locale,'Check for omitted or changed faces and confirm this return belongs to the saved group baseline; do not substitute a remesh.', 'Проверьте, не пропущены ли грани и соответствует ли возврат базовой модели этой группы; не подменяйте его новой сеткой.');break;
  case 'SURFACE_FACE_CORRESPONDENCE_AMBIGUOUS':cause=tr(locale,'More than one returned triangle matches the saved face within tolerance.', 'В пределах допуска найдено несколько соответствующих треугольников.');recovery=tr(locale,'Inspect this group for duplicate or overlapping faces, then correct only the ambiguous return and retry.', 'Проверьте эту группу на дублирующиеся или перекрывающиеся грани, исправьте только неоднозначный возврат и повторите сборку.');break;
  case 'SURFACE_FACE_CORRESPONDENCE_DUPLICATE':cause=tr(locale,'Two saved triangles resolve to the same returned face.', 'Два сохранённых треугольника сопоставлены одной возвращённой грани.');recovery=tr(locale,'Check for duplicated faces in this group and return a unique face for every saved triangle.', 'Проверьте группу на дублирующиеся грани: каждому сохранённому треугольнику должна соответствовать одна уникальная грань.');break;
  case 'SURFACE_REFERENCE_UV_MISSING':cause=tr(locale,'The matched return does not have an active UV layer.', 'У соответствующего возврата нет активного UV-слоя.');recovery=tr(locale,'Restore a valid UV layer on this group without changing its geometry, then retry.', 'Восстановите UV-слой этой группы, не меняя геометрию, затем повторите операцию.');break;
  case 'SURFACE_GROUP_MISSING':case 'SURFACE_GROUP_DUPLICATE':case 'SURFACE_GROUP_SET_MISMATCH':case 'SURFACE_BASELINE_GROUP_MISSING':cause=tr(locale,'The returned group set does not match the saved group baseline.', 'Набор возвращённых групп не совпадает с базовой моделью групп.');recovery=tr(locale,'Return each registered group exactly once and check its assignment against the saved baseline.', 'Верните каждую зарегистрированную группу ровно один раз и проверьте её назначение относительно базовой модели.');break;
  case 'SURFACE_GROUP_ALIGNMENT_FAILED':cause=tr(locale,'The group bounds could not be aligned using one uniform scale and translation.', 'Габариты группы не удалось совместить единым равномерным масштабом и переносом.');recovery=tr(locale,'Check the exported group scale and transforms; nonuniform deformation cannot be used for correspondence.', 'Проверьте масштаб и трансформации экспортированной группы; неравномерное изменение формы нельзя использовать для сопоставления.');break;
  case 'SURFACE_NON_TRIANGULATED_REFERENCE':case 'SURFACE_NON_TRIANGULATED_BASELINE':cause=tr(locale,'The saved surface correspondence expects triangular faces.', 'Для сопоставления сохранённой поверхности нужны треугольные грани.');recovery=tr(locale,'Check the documented group export and triangulation while preserving the saved topology.', 'Проверьте экспорт и триангуляцию группы, сохранив топологию базовой модели.');break;
  case 'SURFACE_RESTORE_CHANGED_RIG_CORE':cause=tr(locale,'The restoration check detected a change to rig, weight, or animation data.', 'Проверка обнаружила изменение данных рига, весов или анимации.');recovery=tr(locale,'Keep this result blocked and inspect the returned rig and saved baseline before retrying.', 'Оставьте результат заблокированным и проверьте возвращённый риг и базовую модель перед повтором.');break;
  default:cause=tr(locale,'The cause could not be determined from this operation report.', 'По этому отчёту не удалось определить причину сбоя.');recovery=tr(locale,'Check the registered inputs and saved baseline, then retry the operation. No geometry cause is inferred.', 'Проверьте зарегистрированные входы и базовую модель, затем повторите операцию. Причина, связанная с геометрией, не предполагается.');
 }
 if(failure?.phase==='legacy'){cause=tr(locale,'An older failed operation has no structured diagnostic, so its cause is unknown.', 'У старой неудачной операции нет структурированной диагностики, поэтому её причина неизвестна.');recovery=tr(locale,'Verify the registered group return and saved baseline, then retry to create a current diagnostic. No geometry cause is inferred.', 'Проверьте зарегистрированный возврат группы и базовую модель, затем повторите операцию для новой диагностики. Причина, связанная с геометрией, не предполагается.');}
 return `${operationContext(locale,operation)} · ${namedGroup}${cause} ${recovery}`;
}

export type SurfaceFailureTransition={kind:'show';operationId:string;failure:any}|{kind:'clear'}|{kind:'keep'};
export function surfaceFailureTransition(operation:any,displayedFailureId:string|null,dismissedFailureId:string|null):SurfaceFailureTransition{
 const operationId=String(operation?.id||'');
 if(operation?.failure&&operationId&&operationId!==dismissedFailureId)return {kind:'show',operationId,failure:operation.failure};
 if(operation?.status==='complete'&&displayedFailureId&&operationId!==displayedFailureId)return {kind:'clear'};
 return {kind:'keep'};
}
