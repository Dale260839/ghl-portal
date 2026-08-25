import type {
  BudgetLine,
  ChangeOrder,
  MaterialSelection,
  Message,
  ProjectDocument,
  ProjectPhoto,
  ScheduleItem,
} from './types';

/**
 * Fixtures for the Phase A client-portal screens.
 *
 * Kept in their own file rather than added to `fixtures.ts`, which is already
 * long. All of it hangs off `BSP-2026-000184` (Johnson Kitchen Remodel) so the
 * portal demo has one coherent project to walk through, matching the client
 * demo's own story.
 *
 * These map onto the `hub_*` tables in `supabase/migrations/0001_hub_tables.sql`
 * field for field, so swapping fixtures for live rows is a data-source change
 * and nothing else.
 */

const PROJECT = 'BSP-2026-000184';

export const SCHEDULE_ITEMS: ScheduleItem[] = [
  {
    id: 'sch-1',
    projectId: PROJECT,
    title: 'Cabinet Installation',
    scheduledDate: '2026-08-17',
    timeWindow: '8:00 AM – 4:00 PM',
    crew: 'Carpentry Team',
    location: 'Main Kitchen',
    status: 'Confirmed',
    clientNote: 'Please ensure the driveway is clear for the delivery truck.',
    accessConfirmed: false,
    clientVisible: true,
  },
  {
    id: 'sch-2',
    projectId: PROJECT,
    title: 'Electrical Trim-Out',
    scheduledDate: '2026-08-19',
    timeWindow: '9:00 AM – 2:00 PM',
    crew: 'Spark Electric',
    location: 'Main Kitchen',
    status: 'Scheduled',
    clientNote: 'We need access to the main breaker panel.',
    accessConfirmed: false,
    clientVisible: true,
  },
  {
    id: 'sch-3',
    projectId: PROJECT,
    title: 'Countertop Measurement',
    scheduledDate: '2026-08-21',
    timeWindow: 'To be confirmed',
    crew: 'Stone Works',
    location: 'Main Kitchen',
    status: 'Tentative',
    clientNote: 'Requires someone present to confirm the edge profile.',
    accessConfirmed: true,
    clientVisible: true,
  },
];

export const DOCUMENTS: ProjectDocument[] = [
  {
    id: 'doc-1',
    projectId: PROJECT,
    name: 'Signed Contract — Johnson Kitchen.pdf',
    category: 'Contracts',
    uploadedDate: '2026-06-15',
    url: '#',
    clientVisible: true,
  },
  {
    id: 'doc-2',
    projectId: PROJECT,
    name: 'City Permit — Building & Electrical.pdf',
    category: 'Permits',
    uploadedDate: '2026-06-28',
    url: '#',
    clientVisible: true,
  },
  {
    id: 'doc-3',
    projectId: PROJECT,
    name: 'Kitchen Floorplan v2.pdf',
    category: 'Plans',
    uploadedDate: '2026-06-22',
    url: '#',
    clientVisible: true,
  },
  {
    id: 'doc-4',
    projectId: PROJECT,
    name: 'Cabinet Warranty Information.pdf',
    category: 'Warranties',
    uploadedDate: '2026-08-05',
    url: '#',
    clientVisible: true,
  },
  {
    id: 'doc-5',
    projectId: PROJECT,
    name: 'Change Order 001 — Signed.pdf',
    category: 'Change Orders',
    uploadedDate: '2026-07-20',
    url: '#',
    clientVisible: true,
  },
  {
    id: 'doc-6',
    projectId: PROJECT,
    name: 'Supplier invoice — cabinet order.pdf',
    category: 'Other',
    uploadedDate: '2026-07-18',
    url: '#',
    // Internal. Present precisely so the documents screen has something it must
    // withhold — a list that shows everything proves nothing.
    clientVisible: false,
  },
];

export const PHOTOS: ProjectPhoto[] = [
  {
    id: 'pho-1',
    projectId: PROJECT,
    caption: 'Base cabinets set and levelled',
    url: '',
    takenDate: '2026-08-01',
    sourceLabel: 'Daily update · 1 Aug',
    clientVisible: true,
  },
  {
    id: 'pho-2',
    projectId: PROJECT,
    caption: 'Cabinet delivery staged in the garage',
    url: '',
    takenDate: '2026-07-29',
    sourceLabel: 'Daily update · 29 Jul',
    clientVisible: true,
  },
  {
    id: 'pho-3',
    projectId: PROJECT,
    caption: 'Sink base cut for plumbing',
    url: '',
    takenDate: '2026-08-01',
    sourceLabel: 'Daily update · 1 Aug',
    clientVisible: true,
  },
  {
    id: 'pho-4',
    projectId: PROJECT,
    caption: 'Scratched door — replacement ordered',
    url: '',
    takenDate: '2026-07-29',
    sourceLabel: 'Issue ISS-000184-001',
    // Withheld: it documents a supplier problem the contractor absorbed.
    clientVisible: false,
  },
];

export const MESSAGES: Message[] = [
  {
    id: 'msg-1',
    projectId: PROJECT,
    threadId: 'thread-team',
    threadCategory: 'Project Team',
    sender: 'Marcus Reyes',
    senderRole: 'Project Manager',
    fromClient: false,
    message:
      "Hi Dana, quick update. The cabinet run passed our internal check this morning, so we're on track for countertop templating next week. I've sent over Change Order #003 for the extra outlets we discussed — please review when you have a chance.",
    sentDate: '2026-08-13',
    clientVisible: true,
  },
  {
    id: 'msg-2',
    projectId: PROJECT,
    threadId: 'thread-team',
    threadCategory: 'Project Team',
    sender: 'Dana Johnson',
    senderRole: 'Homeowner',
    fromClient: true,
    message:
      "That's great news! I just reviewed and approved the change order. For the electrical trim-out, will I need to be home to let the team in?",
    sentDate: '2026-08-13',
    clientVisible: true,
  },
  {
    id: 'msg-3',
    projectId: PROJECT,
    threadId: 'thread-team',
    threadCategory: 'Project Team',
    sender: 'Marcus Reyes',
    senderRole: 'Project Manager',
    fromClient: false,
    message:
      'Thanks for approving that. No need to be home — Tony will be on site to let the electricians in using the lockbox. Have a good weekend!',
    sentDate: '2026-08-14',
    clientVisible: true,
  },
];


/**
 * §6.5 selections.
 *
 * One is deliberately **not** client-visible: an internal supplier substitution
 * the PM has not put to the homeowner yet. A list showing everything proves
 * nothing about the gate; a list that visibly withholds proves it.
 *
 * `actualCost` differs from `allowance` on every row, which is exactly the
 * number a client must never see.
 */
export const SELECTIONS: MaterialSelection[] = [
  {
    id: 'sel-1',
    projectId: PROJECT,
    selectionName: 'Cabinet hardware',
    category: 'Cabinetry',
    roomOrArea: 'Kitchen',
    manufacturer: 'Emtek',
    product: 'Trail Knob',
    colorFinish: 'Satin brass',
    supplier: 'Hardware Supply Co.',
    allowance: 900,
    actualCost: 640,
    upgradeAmount: 0,
    creditAmount: 0,
    leadTime: '2 weeks',
    approvalDeadline: '2026-08-26',
    status: 'Awaiting Client',
    clientDecision: '',
    clientComments: '',
    approvedDate: '',
    clientVisible: true,
  },
  {
    id: 'sel-2',
    projectId: PROJECT,
    selectionName: 'Countertop slab',
    category: 'Surfaces',
    roomOrArea: 'Kitchen',
    manufacturer: 'Cambria',
    product: 'Brittanicca',
    colorFinish: 'Matte',
    supplier: 'Stone Gallery',
    allowance: 6200,
    actualCost: 5100,
    upgradeAmount: 1450,
    creditAmount: 0,
    leadTime: '4 weeks',
    approvalDeadline: '2026-08-22',
    status: 'Approved',
    clientDecision: 'Approved',
    clientComments: 'Happy with the matte finish.',
    approvedDate: '2026-08-11',
    clientVisible: true,
  },
  {
    id: 'sel-3',
    projectId: PROJECT,
    selectionName: 'Pendant lighting',
    category: 'Lighting',
    roomOrArea: 'Kitchen island',
    manufacturer: 'Visual Comfort',
    product: 'Goodman',
    colorFinish: 'Bronze',
    supplier: 'Lightworks',
    allowance: 1200,
    actualCost: 1180,
    upgradeAmount: 0,
    creditAmount: 260,
    leadTime: '3 weeks',
    approvalDeadline: '2026-08-29',
    status: 'Awaiting Client',
    clientDecision: '',
    clientComments: '',
    approvedDate: '',
    clientVisible: true,
  },
  {
    id: 'sel-4',
    projectId: PROJECT,
    selectionName: 'Sink — supplier substitution',
    category: 'Plumbing',
    roomOrArea: 'Kitchen',
    manufacturer: 'Kraus',
    product: 'Standart Pro (substitute)',
    colorFinish: 'Stainless',
    supplier: 'Second-source supplier',
    allowance: 800,
    actualCost: 540,
    upgradeAmount: 0,
    creditAmount: 0,
    leadTime: '1 week',
    approvalDeadline: '',
    status: 'Pending',
    clientDecision: '',
    clientComments: '',
    approvedDate: '',
    // Withheld: the original is back-ordered and the PM has not decided whether
    // to raise it with the client yet.
    clientVisible: false,
  },
];

/** §6.6 change orders. One is a draft the client has not been shown. */
export const CHANGE_ORDERS: ChangeOrder[] = [
  {
    id: 'co-1',
    projectId: PROJECT,
    changeOrderNumber: 'CO-001',
    title: 'Countertop upgrade to Cambria Brittanicca',
    description:
      'Client selected a slab above the countertop allowance. Covers material difference and additional fabrication.',
    reason: 'Client Request',
    requestedBy: 'Dana Johnson',
    createdDate: '2026-08-11',
    addedCost: 1450,
    creditAmount: 0,
    tax: 119.63,
    scheduleImpactDays: 0,
    revisedCompletionDate: '',
    approvalDeadline: '2026-08-18',
    paymentRequirement: 'Billed with the next draw',
    status: 'Approved',
    clientComments: 'Approved — worth it for the finish.',
    approvedBy: 'Dana Johnson',
    approvalDate: '2026-08-12',
    invoiceStatus: 'Queued',
    paymentStatus: 'Not due',
    clientVisible: true,
  },
  {
    id: 'co-2',
    projectId: PROJECT,
    changeOrderNumber: 'CO-002',
    title: 'Additional outlet on the island',
    description:
      'Adds two outlets to the island for small appliances, agreed on site during rough electrical.',
    reason: 'Client Request',
    requestedBy: 'Dana Johnson',
    createdDate: '2026-08-15',
    addedCost: 420,
    creditAmount: 0,
    tax: 34.65,
    scheduleImpactDays: 1,
    revisedCompletionDate: '2026-10-03',
    approvalDeadline: '2026-08-25',
    paymentRequirement: 'Billed with the next draw',
    status: 'Awaiting Client',
    clientComments: '',
    approvedBy: '',
    approvalDate: '',
    invoiceStatus: 'Not raised',
    paymentStatus: 'Not due',
    clientVisible: true,
  },
  {
    id: 'co-3',
    projectId: PROJECT,
    changeOrderNumber: 'CO-003',
    title: 'Framing rework — internal',
    description:
      'Corrects a framing error found at inspection. Absorbed by us; not passed on to the client.',
    reason: 'Design Conflict',
    requestedBy: 'Tony Alvarez',
    createdDate: '2026-08-16',
    addedCost: 1180,
    creditAmount: 0,
    tax: 0,
    scheduleImpactDays: 2,
    revisedCompletionDate: '',
    approvalDeadline: '',
    paymentRequirement: 'Absorbed',
    status: 'Draft',
    clientComments: '',
    approvedBy: '',
    approvalDate: '',
    invoiceStatus: 'Not raised',
    paymentStatus: 'Not due',
    // Withheld: our own error, absorbed. The client is not billed and is not told.
    clientVisible: false,
  },
];

/**
 * The client-facing budget, per category.
 *
 * Every figure here is on the §9.3 allow-list. There is no cost or margin column
 * because `BudgetLine` has no field for one.
 */
export const BUDGET_LINES: BudgetLine[] = [
  { id: 'bl-1', projectId: PROJECT, category: 'Demolition', contracted: 6800, changeOrders: 0, invoiced: 6800, paid: 6800 },
  { id: 'bl-2', projectId: PROJECT, category: 'Cabinetry', contracted: 24500, changeOrders: 0, invoiced: 12250, paid: 12250 },
  { id: 'bl-3', projectId: PROJECT, category: 'Surfaces', contracted: 11200, changeOrders: 1569.63, invoiced: 5600, paid: 5600 },
  { id: 'bl-4', projectId: PROJECT, category: 'Plumbing', contracted: 8400, changeOrders: 0, invoiced: 4200, paid: 4200 },
  { id: 'bl-5', projectId: PROJECT, category: 'Electrical', contracted: 9600, changeOrders: 0, invoiced: 4800, paid: 0 },
  { id: 'bl-6', projectId: PROJECT, category: 'Finishes & paint', contracted: 7300, changeOrders: 0, invoiced: 0, paid: 0 },
];
