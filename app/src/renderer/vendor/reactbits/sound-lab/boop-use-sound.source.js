import { useSound } from '@/components/sounds/react-bits-sound';
import boop from '@/components/sounds/boop';

export default function SaveButton() {
  const play = useSound(boop, { pitch: -3.5, space: 0.4, punch: 0.2, variation: 0.7 });

  return <button onClick={play}>Save changes</button>;
}
