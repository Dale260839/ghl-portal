import type {
  ChangeOrder,
  DesignSelection,
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
    status: 'Client Review Pending',
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
    status: 'Client Review Pending',
    clientComments: '',
    approvedBy: null,
    approvalDate: null,
    internalNotes: 'Do not publish until Marcus confirms the switch location with the electrician.',
    clientVisible: false,
  },
];

/**
 * Design selections for Johnson Kitchen Remodel (Artifact 87).
 *
 * The set walks the full client-facing lifecycle: two Confirmed choices, one
 * Selection Submitted (awaiting the contractor's confirmation), and one still
 * Awaiting Your Selection with a decision deadline. Each carries a baseline
 * allowance option at $0 and one or more priced upgrades, so the "price impact
 * over your allowance" idea has something to show.
 *
 * DS-005 is deliberately not client-visible — priced and staged internally but
 * not yet published, which is what the §9.1 gate looks like on this screen.
 * (Revision Requested is a valid status but is exercised in the unit tests
 * rather than a fixture, the way Rejected is for change orders.)
 */
export const DESIGN_SELECTIONS: DesignSelection[] = [
  {
    id: 'ds-1',
    projectId: PROJECT,
    selectionNumber: '001',
    category: 'Countertops',
    title: 'Countertop material',
    location: 'Main Kitchen',
    description: 'Choose the countertop surface for the perimeter runs and the island.',
    options: [
      {
        id: 'ds-1-a',
        name: 'Laminate (allowance)',
        detail: 'Included in the original scope. Matte finish, square edge.',
        priceImpact: 0,
        isBaseline: true,
        imageUrl: '',
      },
      {
        id: 'ds-1-b',
        name: 'Quartz — Calacatta',
        detail: 'Engineered stone, honed. Consistent veining, low maintenance.',
        priceImpact: 2400,
        isBaseline: false,
        imageUrl: '',
      },
      {
        id: 'ds-1-c',
        name: 'Natural marble',
        detail: 'Carrara. Sealed; will patina with use.',
        priceImpact: 4100,
        isBaseline: false,
        imageUrl: '',
      },
    ],
    selectedOptionId: 'ds-1-b',
    status: 'Confirmed',
    decisionDeadline: '2026-07-12',
    decidedBy: 'Dana Johnson',
    decidedDate: '2026-07-10',
    clientComments: 'Love the low-maintenance option — quartz it is.',
    internalNotes: 'Fabricator lead time 3 weeks from confirmation. Slab reserved.',
    clientVisible: true,
  },
  {
    id: 'ds-2',
    projectId: PROJECT,
    selectionNumber: '002',
    category: 'Tile & Backsplash',
    title: 'Backsplash tile',
    location: 'Main Kitchen',
    description: 'Full-height tile across the sink and range walls.',
    options: [
      {
        id: 'ds-2-a',
        name: 'Ceramic subway 3x6 (allowance)',
        detail: 'Included in the original scope. Gloss white, straight set.',
        priceImpact: 0,
        isBaseline: true,
        imageUrl: '',
      },
      {
        id: 'ds-2-b',
        name: 'Zellige handmade',
        detail: 'Moroccan clay, glossy, variegated. Each tile slightly irregular.',
        priceImpact: 1150,
        isBaseline: false,
        imageUrl: '',
      },
      {
        id: 'ds-2-c',
        name: 'Marble hex mosaic',
        detail: 'Carrara hexagon on mesh sheets.',
        priceImpact: 1650,
        isBaseline: false,
        imageUrl: '',
      },
    ],
    selectedOptionId: 'ds-2-b',
    status: 'Confirmed',
    decisionDeadline: '2026-07-28',
    decidedBy: 'Dana Johnson',
    decidedDate: '2026-07-26',
    clientComments: '',
    internalNotes: 'Zellige needs a wider grout allowance; flagged to the tile crew.',
    clientVisible: true,
  },
  {
    id: 'ds-3',
    projectId: PROJECT,
    selectionNumber: '003',
    category: 'Cabinetry',
    title: 'Cabinet finish',
    location: 'Main Kitchen',
    description: 'Door style and colour for the perimeter and island cabinetry.',
    options: [
      {
        id: 'ds-3-a',
        name: 'White shaker (allowance)',
        detail: 'Included in the original scope. Painted MDF, satin.',
        priceImpact: 0,
        isBaseline: true,
        imageUrl: '',
      },
      {
        id: 'ds-3-b',
        name: 'Two-tone — navy island, white perimeter',
        detail: 'Same shaker door, island painted deep navy.',
        priceImpact: 680,
        isBaseline: false,
        imageUrl: '',
      },
    ],
    selectedOptionId: 'ds-3-b',
    status: 'Selection Submitted',
    decisionDeadline: '2026-08-20',
    decidedBy: null,
    decidedDate: null,
    clientComments: 'Going with the two-tone if the navy matches the sample we saw.',
    internalNotes: 'Confirm navy sheen with the paint shop before ordering doors.',
    clientVisible: true,
  },
  {
    id: 'ds-4',
    projectId: PROJECT,
    selectionNumber: '004',
    category: 'Flooring',
    title: 'Kitchen flooring',
    location: 'Main Kitchen',
    description: 'Surface for the kitchen floor, continuing to the pantry doorway.',
    options: [
      {
        id: 'ds-4-a',
        name: 'Luxury vinyl plank (allowance)',
        detail: 'Included in the original scope. Waterproof, click-lock.',
        priceImpact: 0,
        isBaseline: true,
        imageUrl: '',
      },
      {
        id: 'ds-4-b',
        name: 'Engineered oak',
        detail: 'Wire-brushed, matte. 7-inch planks.',
        priceImpact: 1900,
        isBaseline: false,
        imageUrl: '',
      },
      {
        id: 'ds-4-c',
        name: 'Porcelain wood-look tile',
        detail: 'Rectified plank tile, through-body.',
        priceImpact: 2600,
        isBaseline: false,
        imageUrl: '',
      },
    ],
    selectedOptionId: null,
    status: 'Awaiting Your Selection',
    decisionDeadline: '2026-08-29',
    decidedBy: null,
    decidedDate: null,
    clientComments: '',
    internalNotes: 'Needed before the flooring crew mobilises the week of 1 Sep.',
    clientVisible: true,
  },
  {
    id: 'ds-5',
    projectId: PROJECT,
    selectionNumber: '005',
    category: 'Fixtures',
    title: 'Appliance package',
    location: 'Main Kitchen',
    description: 'Range, hood, and dishwasher package.',
    options: [
      {
        id: 'ds-5-a',
        name: 'Standard stainless (allowance)',
        detail: 'Included in the original scope.',
        priceImpact: 0,
        isBaseline: true,
        imageUrl: '',
      },
      {
        id: 'ds-5-b',
        name: 'Pro-style gas range package',
        detail: '36-inch range with matching hood insert.',
        priceImpact: 3200,
        isBaseline: false,
        imageUrl: '',
      },
    ],
    selectedOptionId: null,
    status: 'Awaiting Your Selection',
    decisionDeadline: null,
    decidedBy: null,
    decidedDate: null,
    clientComments: '',
    // Priced and staged, not yet published — the §9.1 gate on this screen.
    internalNotes: 'Hold until the vendor quote firms up; do not surface the pro package yet.',
    clientVisible: false,
  },
];
