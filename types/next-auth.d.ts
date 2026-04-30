import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      role: "OWNER" | "ADMIN" | "EMPLOYEE";
      employeeId?: string | undefined;
    };
  }
  interface User {
    id?: string;
    role?: "OWNER" | "ADMIN" | "EMPLOYEE";
    employeeId?: string | undefined;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "OWNER" | "ADMIN" | "EMPLOYEE";
    employeeId?: string | undefined;
  }
}
