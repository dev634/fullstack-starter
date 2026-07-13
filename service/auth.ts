import bcrypt from "bcryptjs";
import { findByEmail } from "@/repository/users";
import { loginSchema, type LoginInput } from "@/schemas/auth";

// A throwaway hash computed once at load. When the email is unknown we still
// run a bcrypt.compare against it, so the response time is the same as for a
// known email — closing the user-enumeration timing oracle.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer", 10);

/**
 * Validates the credentials and verifies them against the stored user.
 * Returns the public user payload on success, or null on any failure
 * (invalid input, unknown email, wrong password) so the caller cannot
 * distinguish between "no such user" and "bad password".
 */
export async function verifyCredentials(data: LoginInput) {
    const parsed = loginSchema.safeParse(data);
    if (!parsed.success) {
        return null;
    }

    const user = await findByEmail(parsed.data.email);
    if (!user) {
        // Spend the same time in bcrypt as the real path would.
        await bcrypt.compare(parsed.data.password, DUMMY_HASH);
        return null;
    }

    const passwordMatches = await bcrypt.compare(parsed.data.password, user.password);
    if (!passwordMatches) {
        return null;
    }

    return {
        id: String(user.id),
        email: user.email,
        name: user.name,
        role: user.role,
    };
}
