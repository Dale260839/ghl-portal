import type { ChangeOrder, Message, ProjectDocument, ProjectPhoto, ScheduleItem } from './types';

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
 * Change orders for Johnson Kitchen Remodel.
 *
 * The figures reconcile with the project's financials on the contractor side:
 * `approvedChangeOrders` $3,200 and `pendingChangeOrders` $1,850. A client
 * seeing a different total from the PM is worse than showing none at all.
 *
 * CO-003 carries a credit rather than a cost, and CO-004 is deliberately not
 * client-visible — it is priced but not yet published, which is what the §9.1
 * gate looks like on this screen.
 */
export const CHANGE_ORDERS: ChangeOrder[] = [
  {
    id: 'co-1',
    projectId: PROJECT,
    changeOrderNumber: '001',
    title: 'Additional electrical outlets — island',
    description:
      'Add four outlets to the island cabinetry, two per side, on a dedicated 20-amp circuit.',
    reason: 'Requested during the framing walkthrough to suit small appliances on the island.',
    requestedBy: 'Dana Johnson',
    createdDate: '2026-07-24',
    addedCost: 1450,
    creditAmount: 0,
    scheduleImpactDays: 2,
    revisedCompletionDate: '2026-09-14',
    approvalDeadline: '2026-07-31',
    status: 'Approved',
    clientComments: '',
    approvedBy: 'Dana Johnson',
    approvalDate: '2026-07-26',
    internalNotes: 'Electrician quoted 1,150. Held margin at standard.',
    clientVisible: true,
  },
  {
    id: 'co-2',
    projectId: PROJECT,
    changeOrderNumber: '002',
    title: 'Upgrade to full-height backsplash',
    description:
      'Extend tile from counter to the underside of the upper cabinets across the sink and range walls.',
    reason: 'Selected as an upgrade from the 4-inch splash in the original scope.',
    requestedBy: 'Dana Johnson',
    createdDate: '2026-08-02',
    addedCost: 2150,
    creditAmount: 400,
    scheduleImpactDays: 1,
    revisedCompletionDate: '2026-09-15',
    approvalDeadline: '2026-08-09',
    status: 'Approved',
    clientComments: '',
    approvedBy: 'Dana Johnson',
    approvalDate: '2026-08-05',
    internalNotes: 'Credit is the deleted 4-inch splash material.',
    clientVisible: true,
  },
  {
    id: 'co-3',
    projectId: PROJECT,
    changeOrderNumber: '003',
    title: 'Countertop edge profile — upgrade to mitred',
    description:
      'Change the island edge from eased to a mitred 2-inch profile. Perimeter runs stay eased.',
    reason: 'Confirmed at the countertop template appointment.',
    requestedBy: 'Marcus Reyes',
    createdDate: '2026-08-15',
    addedCost: 1850,
    creditAmount: 0,
    scheduleImpactDays: 0,
    revisedCompletionDate: null,
    approvalDeadline: '2026-08-22',
    status: 'Pending',
    clientComments: '',
    approvedBy: null,
    approvalDate: null,
    internalNotes: 'Fabricator holds the slab until this is signed.',
    clientVisible: true,
  },
  {
    id: 'co-4',
    projectId: PROJECT,
    changeOrderNumber: '004',
    title: 'Under-cabinet lighting',
    description: 'Continuous LED strip under the upper cabinets, switched at the entry.',
    reason: 'Raised on site. Priced, not yet issued.',
    requestedBy: 'Marcus Reyes',
    createdDate: '2026-08-18',
    addedCost: 890,
    creditAmount: 0,
    scheduleImpactDays: 0,
    revisedCompletionDate: null,
    approvalDeadline: null,
    status: 'Pending',
    clientComments: '',
    approvedBy: null,
    approvalDate: null,
    internalNotes: 'Do not publish until Marcus confirms the switch location with the electrician.',
    clientVisible: false,
  },
];
