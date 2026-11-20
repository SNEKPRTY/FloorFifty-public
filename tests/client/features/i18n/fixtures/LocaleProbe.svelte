<script lang="ts">
  import { getLocale } from "../../../../../apps/client/src/paraglide/runtime.js";
  import * as m from "../../../../../apps/client/src/paraglide/messages.js";
</script>

<p data-testid="probe-locale">{getLocale()}</p>
<p data-testid="probe-message">{m.title_play()}</p>
