<?php

namespace App\Notifications\Contracts;

use App\Models\User;

/**
 * Checked by `AppChannel` after the insert; when false the row is deleted and nothing is emitted. It closes the
 * race with a removal (e.g. an unmentioned user) that commits between `shouldSend` and the insert, whose cleanup
 * ran before the row existed; one that commits later finds the row and deletes it itself.
 *
 * Contract: read with `sharedLock` so a removal still in its transaction is waited for, not read as present,
 * and only outside a transaction (inside one the lock would not see the removal's commit).
 */
interface RevalidatesAfterInsert
{
    public function stillApplies(User $notifiable): bool;
}
