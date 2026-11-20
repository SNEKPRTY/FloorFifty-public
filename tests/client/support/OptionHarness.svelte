<script lang="ts">
  /** A self-controlled `OptionGroup` and `PagerDots`, so a pick changes the value the way a screen does. */
  import OptionGroup from "../../../apps/client/src/features/kit/layout/OptionGroup.svelte";
  import PagerDots from "../../../apps/client/src/features/kit/layout/PagerDots.svelte";

  let value = $state("20");
  let page = $state(0);
</script>

<OptionGroup
  label="Floors"
  {value}
  onChange={(next) => (value = next)}
  options={[
    { value: "20", label: "20", testId: "floors-20" },
    { value: "50", label: "50", testId: "floors-50" },
  ]}
/>
<PagerDots count={5} index={page} label="Pages" testId="dot" onSelect={(i) => (page = i)} />
