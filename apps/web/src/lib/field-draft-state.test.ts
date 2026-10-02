import assert from 'node:assert/strict';
import test from 'node:test';
import { hasDraftContents, parseFieldDraft } from './field-draft-state.ts';

const now = Date.parse('2026-10-02T05:00:00Z');
const encode = (values: object, extra: object = {}) => JSON.stringify({savedAt:new Date(now).toISOString(),values,...extra});

test('legacy text-only drafts remain recoverable', () => {
  assert.deepEqual(parseFieldDraft(encode({projectId:'p1',internalNotes:'Private'}),now), {
    savedAt:new Date(now).toISOString(),values:{projectId:'p1',internalNotes:'Private'},photoIds:[],
  });
});

test('saved photo references and every daily field survive parsing', () => {
  const values = {projectId:'p1',workCompleted:'Work',internalNotes:'Notes',clientSummary:'Summary',blocker:'Delay',crewOnsite:'3',hoursWorked:'6.5',weather:'Rain',clientDecisionNeeded:'on'};
  assert.deepEqual(parseFieldDraft(encode(values,{photoIds:['photo1','photo1','photo2']}),now)?.photoIds,['photo1','photo2']);
  assert.deepEqual(parseFieldDraft(encode(values),now)?.values,values);
});

test('unknown values cannot create extra submitted form fields', () => {
  assert.deepEqual(parseFieldDraft(encode({projectId:'p1',role:'contractor',authProfileId:'other'}),now)?.values,{projectId:'p1'});
});

test('malformed, expired and future drafts are refused', () => {
  for (const raw of ['{','null','[]',encode(null!),encode([]),encode({internalNotes:42}),
    encode({}, {savedAt:new Date(now+1).toISOString()}),encode({}, {savedAt:new Date(now-86_400_001).toISOString()})]) {
    assert.equal(parseFieldDraft(raw,now),null);
  }
});

test('photo references must have a project and cannot contain paths or filter syntax', () => {
  for (const extra of [{photoIds:['valid']},{values:{projectId:'p1'},photoIds:'photo1'},
    {values:{projectId:'p1'},photoIds:['../../secret']},{values:{projectId:'p1'},photoIds:['id,other']},
    {values:{projectId:'p1'},photoIds:[null]}]) assert.equal(parseFieldDraft(encode({},extra),now),null);
});

test('an untouched form or project choice alone is not a draft', () => {
  const defaults={crewOnsite:'2',hoursWorked:'8',weather:'Clear',clientDecisionNeeded:'off'};
  assert.equal(hasDraftContents({projectId:'p2',...defaults},[],defaults),false);
  assert.equal(hasDraftContents({projectId:'p1',internalNotes:'   '},[],{}),false);
});

test('photos alone, modified numbers, weather and a decision flag are meaningful drafts', () => {
  const defaults={crewOnsite:'2',hoursWorked:'8',weather:'Clear',clientDecisionNeeded:'off'};
  assert.equal(hasDraftContents({projectId:'p1'},['photo1'],defaults),true);
  for (const [name,value] of Object.entries({crewOnsite:'3',hoursWorked:'6.5',weather:'Rain',clientDecisionNeeded:'on'})) {
    assert.equal(hasDraftContents({projectId:'p1',...defaults,[name]:value},[],defaults),true);
  }
});
