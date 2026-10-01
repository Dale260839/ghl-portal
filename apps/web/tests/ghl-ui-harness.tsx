import { createRoot } from 'react-dom/client';
import { Connecting } from '../src/app/auth/ghl/connecting';

const params = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<>
  <Connecting
    locationId={params.get('locationId') ?? ''}
    signedQuery={params.get('signedQuery') ?? ''}
    parentOrigins={[params.get('parentOrigin') ?? '']}
  />
  <output id="redirect" />
</>);
