<script setup lang="ts">
import { NIcon } from 'naive-ui'
import { Briefcase, BuildingBank, Cash, CreditCard, Wallet } from '@vicons/tabler'
import type { LedgerAccountIcon as AccountIcon } from '../../../shared/ledgerProtocol'
import { LEDGER_BUILTIN_ACCOUNT_ICONS } from '../../../shared/ledgerProtocol'
import { useLedgerAccountIconPreferences } from '../../composables/useLedgerAccountIconPreferences'

const props = withDefaults(defineProps<{ icon?: AccountIcon; size?: number }>(), { icon: 'wallet', size: 17 })
const preferences = useLedgerAccountIconPreferences()
const builtinSources: Readonly<Record<string, string>> = Object.fromEntries(LEDGER_BUILTIN_ACCOUNT_ICONS.map(({ id, src }) => [id, src]))
</script>

<template>
  <img v-if="builtinSources[props.icon]" class="ledger-custom-account-icon" :src="builtinSources[props.icon]" :width="size" :height="size" alt="" aria-hidden="true">
  <img v-else-if="props.icon?.startsWith('custom_') && preferences.getCustomIcon(props.icon)" class="ledger-custom-account-icon" :src="`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preferences.getCustomIcon(props.icon)!)}`" :width="size" :height="size" alt="" aria-hidden="true">
  <NIcon v-else :size="size" aria-hidden="true">
    <Wallet v-if="icon === 'wallet'" />
    <CreditCard v-else-if="icon === 'credit_card'" />
    <Cash v-else-if="icon === 'cash'" />
    <BuildingBank v-else-if="icon === 'building_bank'" />
    <Briefcase v-else />
  </NIcon>
</template>

<style scoped>
.ledger-custom-account-icon { display: block; object-fit: contain; }
</style>
