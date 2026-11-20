<script lang="ts">
  /** Native settings controls under the kit's pick pulse, so a test can tick, choose and slide. */
  import { pickPulse } from "../../../apps/client/src/features/kit/pick-pulse";
</script>

<div use:pickPulse>
  <label><input type="checkbox" data-testid="tick" /> Tick</label>
  <label><input type="radio" name="q" data-testid="high" checked /> High</label>
  <label><input type="radio" name="q" data-testid="low" /> Low</label>
  <label><input type="range" data-testid="level" /> Level</label>
</div>
