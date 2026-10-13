import type { Metadata } from 'next';
import { OpenWorkspaceLanding } from './landing';
export const metadata: Metadata = { title: 'Opening Project Hub', referrer: 'no-referrer' };
export default function Page() { return <OpenWorkspaceLanding />; }
