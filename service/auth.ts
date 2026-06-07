import bcrypt from "bcryptjs";
import { findByEmail } from "@/repository/users";
import { loginSchema, type LoginInput } from "@/schemas/auth";

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
    };
}
