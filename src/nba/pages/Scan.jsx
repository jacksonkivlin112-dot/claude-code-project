import { ScanPage } from '../../pages/Scan.jsx';
import { NBA_CFG, useNbaContext } from './Props.jsx';

export default function NbaScan() {
  return <ScanPage cfg={NBA_CFG} useSportContext={useNbaContext} />;
}
